import { z } from "zod";

const csvIds = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

export const configSchema = z
  .object({
    SENA_MODE: z.enum(["offline", "online"]).default("offline"),
    SENA_DATA_DIR: z.string().min(1).default("./data"),
    SENA_MODULES_DIR: z.string().min(1).default("./modules"),
    SENA_TRUSTED_MODULE_IDS: csvIds,
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    MINECRAFT_HOST: z.string().default(""),
    MINECRAFT_PORT: z.coerce.number().int().min(1).max(65535).default(25565),
    MINECRAFT_USERNAME: z.string().default(""),
    MINECRAFT_AUTH: z.enum(["offline", "microsoft"]).default("offline"),
    MINECRAFT_VERSION: z.string().optional().default(""),
    DISCORD_BOT_TOKEN: z.string().default(""),
    DISCORD_OWNER_IDS: csvIds,
    DISCORD_ADMIN_ROLE_IDS: csvIds,
    DISCORD_COMMAND_CHANNEL_IDS: csvIds,
    DISCORD_GUILD_ID: z.string().default(""),
    DISCORD_REGISTER_COMMANDS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    DISCORD_DASHBOARD_CHANNEL_ID: z.string().default(""),
    DISCORD_ALERTS_CHANNEL_ID: z.string().default(""),
    AI_LLM_PROVIDER: z.enum(["none", "nvidia-nim", "ollama"]).default("none"),
    NVIDIA_NIM_LLM_API_KEY: z.string().default(""),
    NVIDIA_NIM_LLM_MODEL: z.string().default(""),
    NVIDIA_NIM_LLM_BASE_URL: z.string().default(""),
    AI_VLM_PROVIDER: z.enum(["none", "nvidia-nim", "local"]).default("none"),
    NVIDIA_NIM_VLM_API_KEY: z.string().default(""),
    NVIDIA_NIM_VLM_MODEL: z.string().default(""),
    NVIDIA_NIM_VLM_BASE_URL: z.string().default(""),
    OLLAMA_BASE_URL: z.string().default(""),
    OLLAMA_LLM_MODEL: z.string().default(""),
  })
  .superRefine((config, ctx) => {
    if (config.SENA_MODE === "online") {
      if (!config.MINECRAFT_HOST)
        ctx.addIssue({
          code: "custom",
          path: ["MINECRAFT_HOST"],
          message: "Required in online mode",
        });
      if (!config.MINECRAFT_USERNAME)
        ctx.addIssue({
          code: "custom",
          path: ["MINECRAFT_USERNAME"],
          message: "Required in online mode",
        });
    }
    if (
      config.AI_LLM_PROVIDER === "nvidia-nim" &&
      (!config.NVIDIA_NIM_LLM_API_KEY || !config.NVIDIA_NIM_LLM_MODEL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_LLM_PROVIDER"],
        message: "NVIDIA NIM LLM requires its API key and model",
      });
    }
    if (
      config.AI_VLM_PROVIDER === "nvidia-nim" &&
      (!config.NVIDIA_NIM_VLM_API_KEY || !config.NVIDIA_NIM_VLM_MODEL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_VLM_PROVIDER"],
        message: "NVIDIA NIM VLM requires its separate API key and model",
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const summary = result.error.issues
      .map(({ path, message }) => `${path.join(".")}: ${message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${summary}`);
  }
  return result.data;
}
