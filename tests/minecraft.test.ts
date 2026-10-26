import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "mineflayer";
import { ConnectionManager } from "../src/adapters/minecraft/connection-manager.js";
import { PluginRegistry } from "../src/adapters/minecraft/plugin-registry.js";
import { WorldObserver } from "../src/adapters/minecraft/world-observer.js";
import { MinecraftAdapter } from "../src/adapters/minecraft/minecraft-adapter.js";
import { configSchema } from "../src/core/config.js";
import { Health } from "../src/core/health.js";
import { SenaEventBus } from "../src/core/event-bus.js";
import { logger } from "../src/core/logger.js";

function fakeBot(): Bot {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    hasPlugin: () => false,
    loadPlugin: () => undefined,
    pathfinder: {
      stop: vi.fn(),
      goto: vi.fn(async () => undefined),
      setMovements: vi.fn(),
    },
    quit: vi.fn(),
    health: 18,
    food: 16,
    entity: {
      position: { x: 1, y: 64, z: -2 },
    },
    inventory: {
      items: () => [{ name: "oak_log", count: 2 }],
    },
    blockAt: () => null,
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

describe("Minecraft gameplay adapter", () => {
  it("navigates with the loaded Mineflayer pathfinder and stops on cancellation", async () => {
    const bot = fakeBot();
    const movementPolicy = {
      canDig: false,
      allowParkour: false,
      allow1by1towers: false,
      allowSprinting: false,
      maxDropDown: 1,
      scafoldingBlocks: [],
    };
    const config = configSchema.parse({
      SENA_MODE: "online",
      MINECRAFT_HOST: "localhost",
      MINECRAFT_USERNAME: "SenaTest",
    });
    const adapter = new MinecraftAdapter(
      config,
      new Health(),
      new SenaEventBus(),
      () => bot,
      () => movementPolicy as never,
    );
    adapter.start();
    bot.emit("spawn");
    expect(adapter.isMovementReady()).toBe(true);
    await adapter.moveTo({ x: 3, y: 64, z: 0 }, new AbortController().signal);
    expect(bot.pathfinder.goto).toHaveBeenCalledOnce();
    expect(bot.pathfinder.setMovements).toHaveBeenCalledWith(movementPolicy);
    vi.mocked(bot.pathfinder.goto).mockImplementationOnce(
      () => new Promise<void>(() => undefined),
    );
    const controller = new AbortController();
    const pending = adapter.moveTo({ x: 4, y: 64, z: 0 }, controller.signal);
    controller.abort(new Error("cancelled-test"));
    await expect(pending).rejects.toThrow("cancelled-test");
    expect(bot.pathfinder.stop).toHaveBeenCalledOnce();

    const pathfinderError = new Error("pathfinder-rejected");
    vi.mocked(bot.pathfinder.goto).mockRejectedValueOnce(pathfinderError);
    await expect(
      adapter.moveTo({ x: 5, y: 64, z: 0 }, new AbortController().signal),
    ).rejects.toBe(pathfinderError);
    expect(bot.pathfinder.stop).toHaveBeenCalledTimes(2);
    await adapter.moveTo({ x: 6, y: 64, z: 0 }, new AbortController().signal);
    expect(bot.pathfinder.goto).toHaveBeenCalledTimes(4);
    await adapter.stop();
  });
});

describe("world observations", () => {
  it("keeps disconnected fields unknown and stamps live data", () => {
    const missing = new WorldObserver(() => null).snapshot();
    expect(missing.connection).toBe("disconnected");
    expect(missing.position.status).toBe("unknown");

    const live = new WorldObserver(fakeBot).snapshot();
    expect(live.position).toMatchObject({
      value: { x: 1, y: 64, z: -2 },
      status: "known",
      source: "mineflayer",
    });
    expect(live.inventory.value).toEqual([{ name: "oak_log", count: 2 }]);
  });

  it("marks cached facts stale after disconnect and keeps unavailable block data unknown", () => {
    let connected: Bot | null = fakeBot();
    const observer = new WorldObserver(() => connected);
    const fresh = observer.snapshot([{ x: 1, y: 64, z: -2 }]);
    expect(fresh.position.status).toBe("known");
    expect(fresh.blocks.status).toBe("unknown");
    connected = null;
    const stale = observer.snapshot();
    expect(stale.connection).toBe("disconnected");
    expect(stale.position.status).toBe("stale");
    expect(stale.position.observedAt).toBe(fresh.position.observedAt);
  });

  it("bounds and normalizes nearby entity observations", () => {
    const bot = fakeBot();
    Object.assign(bot, {
      entities: {
        1: {
          id: 1,
          name: "zombie",
          type: "mob",
          position: { x: 4, y: 64, z: -2 },
          health: 16,
        },
        2: {
          id: 2,
          name: "distant",
          type: "mob",
          position: { x: 100, y: 64, z: 0 },
        },
      },
    });
    const snapshot = new WorldObserver(() => bot).snapshot();
    expect(snapshot.entities.value).toEqual([
      expect.objectContaining({
        id: 1,
        name: "zombie",
        distance: 3,
        health: 16,
      }),
    ]);
  });

  it("does not invent nearby entity distances when player position is invalid", () => {
    const bot = fakeBot();
    Object.assign(bot.entity, { position: { x: Number.NaN, y: 64, z: 0 } });
    Object.assign(bot, {
      entities: {
        1: {
          id: 1,
          name: "near-origin-only",
          type: "mob",
          position: { x: 20, y: 0, z: 0 },
        },
      },
    });

    const snapshot = new WorldObserver(() => bot).snapshot();
    expect(snapshot.position.status).toBe("unknown");
    expect(snapshot.entities).toMatchObject({ status: "unknown", value: null });
  });

  it("bounds entity results and exposes when the nearest-entity list was truncated", () => {
    const bot = fakeBot();
    Object.assign(bot, {
      entities: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          index + 1,
          {
            id: index + 1,
            name: `mob-${index + 1}`,
            type: "mob",
            position: { x: 2, y: 64, z: -2 + (index % 2) },
          },
        ]),
      ),
    });
    const snapshot = new WorldObserver(() => bot).snapshot();
    expect(snapshot.entities.value).toHaveLength(32);
    expect(snapshot.entities.truncated).toBe(true);
    expect(snapshot.entities.value?.[0]?.distance).toBe(1);
  });

  it("does not query invalid or oversized requested block positions", () => {
    const bot = fakeBot();
    const blockAt = vi.spyOn(bot, "blockAt");
    const observer = new WorldObserver(() => bot);
    const invalid = observer.snapshot([{ x: 30_000_001, y: 64, z: 0 }]);
    const oversized = observer.snapshot(
      Array.from({ length: 33 }, (_, x) => ({ x, y: 64, z: 0 })),
    );

    expect(invalid.blocks).toMatchObject({ status: "unknown", value: null });
    expect(oversized.blocks).toMatchObject({
      status: "unknown",
      value: null,
      truncated: true,
    });
    expect(blockAt).not.toHaveBeenCalled();
  });
});
