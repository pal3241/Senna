import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverModules } from "../src/core/modules/discovery.js";
import { supportsApiVersion } from "../src/core/modules/manifest.js";

const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sena-modules-"));
  roots.push(root);
  return root;
}

async function addModule(
  root: string,
  folder: string,
  manifest: Record<string, unknown>,
  entry = "export default { start() {} };\n",
): Promise<void> {
  const directory = join(root, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "module.json"), JSON.stringify(manifest));
  if (manifest.entry === "index.js")
    await writeFile(join(directory, "index.js"), entry);
}

function manifest(id: string, extra: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    id,
    name: `Module ${id}`,
    version: "1.0.0",
    description: "test module",
    entry: "index.js",
    api_version: "^1.0.0",
    capabilities: [],
    dependencies: [],
    permissions: [],
    enabled_by_default: true,
    ...extra,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("module discovery and trust", () => {
  it("orders trusted modules and leaves community modules untrusted", async () => {
    const root = await createRoot();
    await addModule(root, "base", manifest("base"));
    await addModule(
      root,
      "extension",
      manifest("extension", { dependencies: ["base"] }),
    );
    const result = await discoverModules({
      modulesDirectory: root,
      builtinModuleIds: new Set(["base"]),
    });
    expect(result.loadOrder.map((record) => record.manifest?.id)).toEqual([
      "base",
    ]);
    expect(
      result.modules.find((record) => record.manifest?.id === "extension"),
    ).toMatchObject({ status: "untrusted", trusted: false });
  });

  it("rejects entry traversal and isolates invalid module folders", async () => {
    const root = await createRoot();
    await addModule(
      root,
      "malicious",
      manifest("malicious", { entry: "../outside.js" }),
    );
    await mkdir(join(root, "missing-manifest"));
    const result = await discoverModules({ modulesDirectory: root });
    expect(result.loadOrder).toHaveLength(0);
    expect(result.modules.every((record) => record.status === "invalid")).toBe(
      true,
    );
    expect(result.modules.map((record) => record.reason).join(" ")).toMatch(
      /entry|ENOENT/,
    );
  });

  it("rejects duplicate IDs and dependency cycles", async () => {
    const root = await createRoot();
    await addModule(root, "dup-one", manifest("duplicate"));
    await addModule(root, "dup-two", manifest("duplicate"));
    await addModule(
      root,
      "cycle-a",
      manifest("cycle-a", { dependencies: ["cycle-b"] }),
    );
    await addModule(
      root,
      "cycle-b",
      manifest("cycle-b", { dependencies: ["cycle-a"] }),
    );
    await addModule(
      root,
      "cycle-consumer",
      manifest("cycle-consumer", { dependencies: ["cycle-a"] }),
    );
    await addModule(
      root,
      "missing-consumer",
      manifest("missing-consumer", { dependencies: ["absent"] }),
    );
    const result = await discoverModules({
      modulesDirectory: root,
      trustedModuleIds: new Set([
        "duplicate",
        "cycle-a",
        "cycle-b",
        "cycle-consumer",
        "missing-consumer",
      ]),
    });
    expect(
      result.modules
        .filter((record) => record.manifest?.id === "duplicate")
        .every((record) => record.status === "duplicate"),
    ).toBe(true);
    expect(
      result.modules.filter((record) => record.status === "cycle"),
    ).toHaveLength(2);
    expect(
      result.modules.find((record) => record.manifest?.id === "cycle-consumer")
        ?.status,
    ).toBe("dependency-failed");
    expect(
      result.modules.find(
        (record) => record.manifest?.id === "missing-consumer",
      )?.status,
    ).toBe("dependency-failed");
    expect(result.loadOrder).toHaveLength(0);
  });

  it("checks semver range lower bounds", () => {
    expect(supportsApiVersion("^1.0.0", "1.4.2")).toBe(true);
    expect(supportsApiVersion("^1.2.0", "1.1.9")).toBe(false);
    expect(supportsApiVersion("~1.2.0", "1.3.0")).toBe(false);
    expect(supportsApiVersion("1.0.0", "1.0.1")).toBe(false);
  });
});
