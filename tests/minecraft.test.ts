import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { ConnectionManager } from "../src/adapters/minecraft/connection-manager.js";
import { PluginRegistry } from "../src/adapters/minecraft/plugin-registry.js";
import { WorldObserver } from "../src/adapters/minecraft/world-observer.js";
import { logger } from "../src/core/logger.js";

function fakeBot(): Bot {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    hasPlugin: () => false,
    loadPlugin: () => undefined,
    pathfinder: { stop: vi.fn() },
    quit: vi.fn(),
    health: 18,
    food: 16,
    entity: {
      position: { x: 1, y: 64, z: -2 },
    },
    inventory: {
      items: () => [{ name: "oak_log", count: 2 }],
    },
    entities: {},
  }) as unknown as Bot;
}

const connectionConfig = {
  host: "127.0.0.1",
  port: 25565,
  username: "SenaTest",
  auth: "offline" as const,
  version: "",
};

afterEach(() => vi.useRealTimers());

describe("Mineflayer connector", () => {
  it("loads pathfinder once, reports real spawn observations, and stops cleanly", async () => {
    const bot = fakeBot();
    const pluginRegistry = new PluginRegistry();
    const states: string[] = [];
    const health: number[] = [];
    const deaths: number[] = [];
    const manager = new ConnectionManager(
      connectionConfig,
      pluginRegistry,
      {
        onState: (state) => states.push(state),
        onSpawn: () => undefined,
        onHealth: (value) => health.push(value),
        onDeath: () => deaths.push(1),
      },
      logger,
      () => bot,
      1,
      2,
      100,
    );

    manager.start();
    expect(pluginRegistry.getStatus()).toMatchObject([
      { id: "mineflayer-pathfinder", state: "loaded" },
    ]);
    bot.emit("spawn");
    bot.emit("health");
    bot.emit("death");
    expect(manager.getState()).toBe("spawned");
    expect(pluginRegistry.getStatus()[0]?.state).toBe("ready");
    expect(health).toEqual([18]);
    expect(deaths).toEqual([1]);

    await manager.stop();
    expect(bot.quit).toHaveBeenCalledOnce();
    expect(states).toContain("connecting");
    expect(states.at(-1)).toBe("disconnected");
  });

  it("bounds retries after repeated connection failures", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const manager = new ConnectionManager(
      connectionConfig,
      new PluginRegistry(),
      {
        onState: (state) => states.push(state),
        onSpawn: () => undefined,
        onHealth: () => undefined,
        onDeath: () => undefined,
      },
      logger,
      () => {
        throw new Error("connect refused");
      },
      1,
      2,
      100,
    );
    manager.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(manager.getState()).toBe("failed");
    expect(states.filter((state) => state === "connecting")).toHaveLength(3);
    await manager.stop();
  });

  it("closes a failed client before starting a replacement", async () => {
    vi.useFakeTimers();
    const disconnectedBot = fakeBot();
    const replacementBot = fakeBot();
    const factory = vi
      .fn<() => Bot>()
      .mockReturnValueOnce(disconnectedBot)
      .mockReturnValueOnce(replacementBot);
    const manager = new ConnectionManager(
      connectionConfig,
      new PluginRegistry(),
      {
        onState: () => undefined,
        onSpawn: () => undefined,
        onHealth: () => undefined,
        onDeath: () => undefined,
      },
      logger,
      factory,
      1,
      2,
      100,
    );
    manager.start();
    disconnectedBot.emit("error", new Error("connection lost"));
    expect(disconnectedBot.quit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.getBot()).toBe(replacementBot);
    await manager.stop();
  });

  it("closes a failed client before starting a replacement", async () => {
    vi.useFakeTimers();
    const disconnectedBot = fakeBot();
    const replacementBot = fakeBot();
    const factory = vi
      .fn<() => Bot>()
      .mockReturnValueOnce(disconnectedBot)
      .mockReturnValueOnce(replacementBot);
    const manager = new ConnectionManager(
      connectionConfig,
      new PluginRegistry(),
      {
        onState: () => undefined,
        onSpawn: () => undefined,
        onHealth: () => undefined,
        onDeath: () => undefined,
      },
      logger,
      factory,
      1,
      2,
      100,
    );
    manager.start();
    disconnectedBot.emit("error", new Error("connection lost"));
    expect(disconnectedBot.quit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(manager.getBot()).toBe(replacementBot);
    await manager.stop();
  });
});

describe("world observations", () => {
  it("keeps disconnected fields unknown and stamps live data", () => {
    const missing = new WorldObserver(() => null).snapshot();
    expect(missing.connection).toBe("unknown");
    expect(missing.position.status).toBe("unknown");

    const live = new WorldObserver(fakeBot).snapshot();
    expect(live.position).toMatchObject({
      value: { x: 1, y: 64, z: -2 },
      status: "known",
      source: "mineflayer",
    });
    expect(live.inventory.value).toEqual([{ name: "oak_log", count: 2 }]);
  });
});
