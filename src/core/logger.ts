import pino from "pino";

const secretKey = /token|password|secret|api.?key|authorization|cookie/i;
const secretValue = /((?:Bearer\s+)?)([A-Za-z0-9_\-]{24,})/g;

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: [
      "*.token",
      "*.password",
      "*.secret",
      "*.apiKey",
      "*.authorization",
      "env.*",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err(error: Error) {
      return { name: error.name, message: redactText(error.message) };
    },
  },
  messageKey: "message",
});

export function redactText(input: string): string {
  const configuredSecrets = Object.entries(process.env)
    .filter(([key, value]) => secretKey.test(key) && Boolean(value))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
  const withConfiguredSecretsRemoved = configuredSecrets.reduce(
    (text, secret) => text.split(secret).join("[REDACTED]"),
    input,
  );
  return withConfiguredSecretsRemoved.replace(secretValue, "$1[REDACTED]");
}

export function safeFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      secretKey.test(key)
        ? "[REDACTED]"
        : typeof value === "string"
          ? redactText(value)
          : value,
    ]),
  );
}
