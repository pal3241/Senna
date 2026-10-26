import type { Bot, Plugin } from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { logger } from "../../core/logger.js";

export type PluginState =
  | "discovered"
  | "compatible"
  | "loaded"
  | "ready"
  | "degraded"
  | "failed"
  | "disabled";

export interface PluginStatus {
  id: string;
  state: PluginState;
  reason: string | null;
  dependencies: string[];
}

interface PluginDescriptor {
  id: string;
  plugin: Plugin;
  dependencies: string[];
  verify(bot: Bot): boolean;
}

export class PluginRegistry {
  private readonly descriptors: PluginDescriptor[] = [
    {
      id: "mineflayer-pathfinder",
      plugin: pathfinder,
      dependencies: [],
      verify: (bot) => bot.pathfinder !== undefined,
    },
  ];
  private statuses = new Map<string, PluginStatus>();

  load(bot: Bot): PluginStatus[] {
    this.statuses.clear();
    const loaded = new Set<string>();
    for (const descriptor of this.descriptors) {
      const missing = descriptor.dependencies.filter(
        (dependency) => !loaded.has(dependency),
      );
      if (missing.length > 0) {
        this.statuses.set(descriptor.id, {
          id: descriptor.id,
          state: "disabled",
          reason: `Missing plugin dependencies: ${missing.join(", ")}`,
          dependencies: descriptor.dependencies,
        });
        continue;
      }
      try {
        if (!bot.hasPlugin(descriptor.plugin))
          bot.loadPlugin(descriptor.plugin);
        if (!descriptor.verify(bot))
          throw new Error("Plugin API verification failed after load");
        loaded.add(descriptor.id);
        this.statuses.set(descriptor.id, {
          id: descriptor.id,
          state: "loaded",
          reason: null,
          dependencies: descriptor.dependencies,
        });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Plugin failed to load";
        logger.error(
          { pluginId: descriptor.id, reason },
          "Minecraft plugin failed to load",
        );
        this.statuses.set(descriptor.id, {
          id: descriptor.id,
          state: "failed",
          reason,
          dependencies: descriptor.dependencies,
        });
      }
    }
    return this.getStatus();
  }

  markReady(): void {
    for (const [id, status] of this.statuses) {
      if (status.state === "loaded")
        this.statuses.set(id, { ...status, state: "ready" });
    }
  }

  stop(bot: Bot): void {
    const pathfinderStatus = this.statuses.get("mineflayer-pathfinder");
    if (
      pathfinderStatus &&
      pathfinderStatus.state !== "failed" &&
      bot.pathfinder
    ) {
      bot.pathfinder.stop();
    }
    for (const [id, status] of this.statuses) {
      if (status.state !== "failed")
        this.statuses.set(id, { ...status, state: "disabled" });
    }
  }

  getStatus(): PluginStatus[] {
    return [...this.statuses.values()].map((status) => ({
      ...status,
      dependencies: [...status.dependencies],
    }));
  }
}
