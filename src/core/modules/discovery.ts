import { readFile, readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  moduleManifestSchema,
  supportsApiVersion,
  type ModuleManifest,
} from "./manifest.js";

export type ModuleStatus =
  | "compatible"
  | "untrusted"
  | "invalid"
  | "duplicate"
  | "dependency-failed"
  | "cycle";

export interface ModuleRecord {
  directory: string;
  manifestPath: string;
  entryPath: string | null;
  manifest: ModuleManifest | null;
  status: ModuleStatus;
  reason: string | null;
  trusted: boolean;
}

export interface ModuleDiscoveryOptions {
  modulesDirectory: string;
  trustedModuleIds?: ReadonlySet<string>;
  builtinModuleIds?: ReadonlySet<string>;
  apiVersion?: string;
}

export interface ModuleDiscoveryResult {
  modules: ModuleRecord[];
  loadOrder: ModuleRecord[];
}

const maxManifestBytes = 64 * 1024;

export async function discoverModules(
  options: ModuleDiscoveryOptions,
): Promise<ModuleDiscoveryResult> {
  const root = resolve(options.modulesDirectory);
  const trusted = new Set([
    ...(options.trustedModuleIds ?? []),
    ...(options.builtinModuleIds ?? []),
  ]);
  let children: Dirent[];
  try {
    children = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { modules: [], loadOrder: [] };
    throw error;
  }

  const records: ModuleRecord[] = [];
  for (const child of children
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = resolve(root, child.name);
    const manifestPath = resolve(directory, "module.json");
    const record: ModuleRecord = {
      directory,
      manifestPath,
      entryPath: null,
      manifest: null,
      status: "invalid",
      reason: null,
      trusted: false,
    };
    try {
      const manifestBytes = await readFile(manifestPath);
      if (manifestBytes.byteLength > maxManifestBytes)
        throw new Error("module.json exceeds 64 KB");
      const raw: unknown = JSON.parse(manifestBytes.toString("utf8"));
      const parsed = moduleManifestSchema.safeParse(raw);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      record.manifest = parsed.data;
      if (!supportsApiVersion(parsed.data.api_version, options.apiVersion)) {
        record.reason = `Module API ${parsed.data.api_version} is incompatible with core API ${options.apiVersion ?? "1.0.0"}`;
        records.push(record);
        continue;
      }
      record.entryPath = await validateEntry(directory, parsed.data.entry);
      record.trusted = trusted.has(parsed.data.id);
      record.status = record.trusted ? "compatible" : "untrusted";
      if (!record.trusted)
        record.reason = "Module code is not trusted and will not be executed";
    } catch (error) {
      record.reason =
        error instanceof Error ? error.message : "Module validation failed";
    }
    records.push(record);
  }

  const ids = new Map<string, ModuleRecord[]>();
  for (const record of records) {
    if (!record.manifest) continue;
    const list = ids.get(record.manifest.id) ?? [];
    list.push(record);
    ids.set(record.manifest.id, list);
  }
  for (const duplicates of ids.values()) {
    if (duplicates.length < 2) continue;
    for (const record of duplicates) {
      record.status = "duplicate";
      record.reason = `Duplicate module ID: ${record.manifest?.id}`;
    }
  }

  const eligible = new Map(
    records
      .filter((record) => record.status === "compatible" && record.manifest)
      .map((record) => [record.manifest!.id, record]),
  );
  removeModulesWithUnavailableDependencies(eligible);

  const { order, cyclic } = topologicalOrder(eligible);
  for (const record of cyclic) {
    record.status = "cycle";
    record.reason = "Module dependency cycle detected";
  }
  const blocked = new Set(cyclic.map((record) => record.manifest!.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of order) {
      const id = record.manifest!.id;
      if (
        !blocked.has(id) &&
        record.manifest!.dependencies.some((dependency) =>
          blocked.has(dependency),
        )
      ) {
        blocked.add(id);
        record.status = "dependency-failed";
        record.reason = "A required module has a dependency cycle";
        changed = true;
      }
    }
  }
  return {
    modules: records,
    loadOrder: order.filter((record) => !blocked.has(record.manifest!.id)),
  };
}

function removeModulesWithUnavailableDependencies(
  modules: Map<string, ModuleRecord>,
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of [...modules.values()]) {
      const missing = record.manifest!.dependencies.find(
        (dependency) => !modules.has(dependency),
      );
      if (!missing) continue;
      record.status = "dependency-failed";
      record.reason = `Required module ${missing} is missing, incompatible, or untrusted`;
      modules.delete(record.manifest!.id);
      changed = true;
    }
  }
}

async function validateEntry(
  moduleDirectory: string,
  entry: string,
): Promise<string> {
  if (entry.includes("\\") || isAbsolute(entry))
    throw new Error(
      "Module entry must be a relative path using forward slashes",
    );
  const resolvedDirectory = await realpath(moduleDirectory);
  const lexicalPath = resolve(moduleDirectory, entry);
  const lexicalRelative = relative(resolve(moduleDirectory), lexicalPath);
  if (
    !lexicalRelative ||
    lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new Error(
      "Module entry must point to a file inside its module folder",
    );
  }
  const resolvedEntry = await realpath(lexicalPath);
  const actualRelative = relative(resolvedDirectory, resolvedEntry);
  if (
    !actualRelative ||
    actualRelative === ".." ||
    actualRelative.startsWith(`..${sep}`) ||
    isAbsolute(actualRelative)
  ) {
    throw new Error("Module entry resolves outside its module folder");
  }
  if (!(await stat(resolvedEntry)).isFile())
    throw new Error("Module entry is not a regular file");
  return resolvedEntry;
}

function topologicalOrder(modules: Map<string, ModuleRecord>): {
  order: ModuleRecord[];
  cyclic: ModuleRecord[];
} {
  const ordered: ModuleRecord[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclicIds = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      for (const cycleId of path.slice(path.indexOf(id)))
        cyclicIds.add(cycleId);
      cyclicIds.add(id);
      return;
    }
    const record = modules.get(id);
    if (!record?.manifest) return;
    visiting.add(id);
    for (const dependency of record.manifest.dependencies)
      visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
    ordered.push(record);
  };
  for (const id of modules.keys()) visit(id, []);
  const cyclic = [...cyclicIds]
    .map((id) => modules.get(id))
    .filter((record): record is ModuleRecord => Boolean(record));
  const cycleSet = new Set(cyclic);
  return { order: ordered.filter((record) => !cycleSet.has(record)), cyclic };
}
