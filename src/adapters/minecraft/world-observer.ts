import type { Bot } from "mineflayer";

export type FactStatus = "known" | "unknown";

export interface WorldFact<T> {
  value: T | null;
  status: FactStatus;
  source: "mineflayer";
  observedAt: string | null;
}

export interface WorldSnapshot {
  connection: "spawned" | "unknown";
  position: WorldFact<{ x: number; y: number; z: number }>;
  health: WorldFact<number>;
  food: WorldFact<number>;
  inventory: WorldFact<Array<{ name: string; count: number }>>;
  entities: WorldFact<
    Array<{
      id: number;
      name: string;
      type: string;
      position: { x: number; y: number; z: number };
    }>
  >;
}

export class WorldObserver {
  constructor(private readonly getBot: () => Bot | null) {}

  snapshot(): WorldSnapshot {
    const bot = this.getBot();
    const observedAt = new Date().toISOString();
    if (!bot || !bot.entity) {
      const unknown = <T>(): WorldFact<T> => ({
        value: null,
        status: "unknown",
        source: "mineflayer",
        observedAt: null,
      });
      return {
        connection: "unknown",
        position: unknown(),
        health: unknown(),
        food: unknown(),
        inventory: unknown(),
        entities: unknown(),
      };
    }
    const position = bot.entity.position;
    const finitePosition =
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
        ? { x: position.x, y: position.y, z: position.z }
        : null;
    const entities = Object.values(bot.entities)
      .filter(
        (entity) =>
          entity.position &&
          Number.isFinite(entity.position.x) &&
          Number.isFinite(entity.position.y) &&
          Number.isFinite(entity.position.z),
      )
      .slice(0, 100)
      .map((entity) => ({
        id: entity.id,
        name: entity.username ?? entity.name ?? entity.type,
        type: entity.type,
        position: {
          x: entity.position.x,
          y: entity.position.y,
          z: entity.position.z,
        },
      }));
    return {
      connection: "spawned",
      position: fact(finitePosition, observedAt),
      health: fact(Number.isFinite(bot.health) ? bot.health : null, observedAt),
      food: fact(Number.isFinite(bot.food) ? bot.food : null, observedAt),
      inventory: fact(
        bot.inventory
          ? bot.inventory
              .items()
              .map((item) => ({ name: item.name, count: item.count }))
          : null,
        observedAt,
      ),
      entities: fact(entities, observedAt),
    };
  }
}

function fact<T>(value: T | null, observedAt: string): WorldFact<T> {
  return {
    value,
    status: value === null ? "unknown" : "known",
    source: "mineflayer",
    observedAt: value === null ? null : observedAt,
  };
}
