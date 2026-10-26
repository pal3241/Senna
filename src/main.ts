import { bootstrap } from "./app/bootstrap.js";
import { logger } from "./core/logger.js";

const runtime = await bootstrap();
await runtime.start();
const heartbeat = setInterval(() => {
  logger.debug({ health: runtime.health.get() }, "Runtime heartbeat");
}, 60_000);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  try {
    await runtime.stop(signal);
  } catch (error) {
    logger.error({ err: error }, "Graceful shutdown failed");
    process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
  }
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
