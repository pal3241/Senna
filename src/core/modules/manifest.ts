import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);
const semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );

export const modulePermissions = [
  "events.subscribe",
  "world.read",
  "tasks.read",
  "tasks.enqueue",
  "tasks.cancel",
  "actions.request",
  "memory.read",
  "memory.write",
] as const;

export const moduleManifestSchema = z
  .object({
    schema_version: z.literal("1.0"),
    id: identifier,
    name: z.string().trim().min(1).max(128),
    version: semver,
    description: z.string().max(1000),
    entry: z.string().min(1).max(256),
    api_version: z
      .string()
      .regex(/^(\^|~)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    capabilities: z.array(identifier).max(64),
    dependencies: z.array(identifier).max(64),
    permissions: z
      .array(z.enum(modulePermissions))
      .max(modulePermissions.length),
    enabled_by_default: z.boolean().default(false),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
      ctx.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Capability names must be unique",
      });
    }
    if (new Set(manifest.dependencies).size !== manifest.dependencies.length) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Dependencies must be unique",
      });
    }
    if (new Set(manifest.permissions).size !== manifest.permissions.length) {
      ctx.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "Permissions must be unique",
      });
    }
  });

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

export const coreModuleApiVersion = "1.0.0";

export function supportsApiVersion(
  range: string,
  coreVersion = coreModuleApiVersion,
): boolean {
  const requested = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(coreVersion);
  if (!requested || !current) return false;
  const [, operator = "", major, minor, patch] = requested;
  const [, coreMajor, coreMinor, corePatch] = current;
  if (!major || !minor || !patch || !coreMajor || !coreMinor || !corePatch)
    return false;
  const lower = [Number(major), Number(minor), Number(patch)];
  const actual = [Number(coreMajor), Number(coreMinor), Number(corePatch)];
  const compare = (left: number[], right: number[]) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index])
        return (left[index] ?? 0) - (right[index] ?? 0);
    }
    return 0;
  };
  if (operator === "^") {
    const ceilingMatches =
      lower[0] !== 0
        ? actual[0] === lower[0]
        : lower[1] !== 0
          ? actual[0] === 0 && actual[1] === lower[1]
          : actual[0] === 0 && actual[1] === 0 && actual[2] === lower[2];
    return ceilingMatches && compare(actual, lower) >= 0;
  }
  if (operator === "~") {
    return (
      actual[0] === lower[0] &&
      actual[1] === lower[1] &&
      compare(actual, lower) >= 0
    );
  }
  return compare(actual, lower) === 0;
}
