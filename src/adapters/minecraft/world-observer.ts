import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

export type FactStatus = "known" | "stale" | "unknown";

export interface WorldFact<T> {
  value: T | null;
  status: FactStatus;
  source: "mineflayer";
  observedAt: string | null;
  truncated?: boolean;
}

export interface BlockObservation {
  position: { x: number; y: number; z: number };
  name: string;
}

export interface WorldSnapshot {
  connection: "spawned" | "disconnected";
  observedAt: string;
  position: WorldFact<{ x: number; y: number; z: number }>;
  dimension: WorldFact<string>;
  gameMode: WorldFact<string>;
  health: WorldFact<number>;
  food: WorldFact<number>;
  oxygen: WorldFact<number>;
  inventory: WorldFact<Array<{ name: string; count: number }>>;
  equipment: WorldFact<Array<{ slot: number; name: string; count: number }>>;
  entities: WorldFact<
    Array<{
      id: number;
      name: string;
      type: string;
      position: { x: number; y: number; z: number };
      distance: number;
      health: number | null;
    }>
  >;
  blocks: WorldFact<BlockObservation[]>;
}

const unknownFact = <T>(): WorldFact<T> => ({
  value: null,
  status: "unknown",
  source: "mineflayer",
  observedAt: null,
});

export class WorldObserver {
  private previous: WorldSnapshot | null = null;

  constructor(private readonly getBot: () => Bot | null) {}

  snapshot(
    blockPositions: readonly { x: number; y: number; z: number }[] = [],
  ): WorldSnapshot {
    const observedAt = new Date().toISOString();
    const bot = this.getBot();
    if (!bot || !bot.entity) {
      const snapshot = this.previous
        ? staleSnapshot(this.previous, observedAt)
        : emptySnapshot(observedAt);
      return { ...snapshot, connection: "disconnected" };
    }

    const position = finitePosition(bot.entity.position);
    const nearbyEntities = position
      ? Object.values(bot.entities)
          .filter(
            (entity) => entity.position && finitePosition(entity.position),
          )
          .map((entity) => {
            const entityPosition = finitePosition(entity.position)!;
            return {
              id: entity.id,
              name: entity.username ?? entity.name ?? entity.type,
              type: entity.type,
              position: entityPosition,
              distance: distance(position, entityPosition),
              health: Number.isFinite(entity.health) ? entity.health! : null,
            };
          })
          .filter((entity) => entity.distance <= 32)
          .sort((a, b) => a.distance - b.distance)
      : null;

    const blockRequestsValid =
      blockPositions.length <= 32 && blockPositions.every(isValidBlockPosition);
    const boundedBlockPositions = blockRequestsValid ? blockPositions : [];
    const blocks = blockRequestsValid
      ? observeBlocks(bot, boundedBlockPositions)
      : null;

    const snapshot: WorldSnapshot = {
      connection: "spawned",
      observedAt,
      position: fact(position, observedAt),
      dimension: fact(nonEmptyString(bot.game?.dimension), observedAt),
      gameMode: fact(nonEmptyString(bot.game?.gameMode), observedAt),
      health: fact(finiteNumber(bot.health), observedAt),
      food: fact(finiteNumber(bot.food), observedAt),
      oxygen: fact(finiteNumber(bot.oxygenLevel), observedAt),
      inventory: inventoryFact(bot, observedAt),
      equipment: fact(
        Array.isArray(bot.entity.equipment)
          ? bot.entity.equipment
              .flatMap((item, slot) =>
                item ? [{ slot, name: item.name, count: item.count }] : [],
              )
              .slice(0, 8)
          : null,
        observedAt,
      ),
      entities:
        nearbyEntities === null
          ? unknownFact()
          : fact(
              nearbyEntities.slice(0, 32),
              observedAt,
              nearbyEntities.length > 32,
            ),
      blocks:
        blockPositions.length === 0
          ? fact([], observedAt)
          : blockRequestsValid
            ? fact<BlockObservation[]>(blocks, observedAt)
            : fact<BlockObservation[]>(
                null,
                observedAt,
                blockPositions.length > 32,
              ),
    };
    this.previous = snapshot;
    return snapshot;
  }
}

function emptySnapshot(observedAt: string): WorldSnapshot {
  return {
    connection: "disconnected",
    observedAt,
    position: unknownFact(),
    dimension: unknownFact(),
    gameMode: unknownFact(),
    health: unknownFact(),
    food: unknownFact(),
    oxygen: unknownFact(),
    inventory: unknownFact(),
    equipment: unknownFact(),
    entities: unknownFact(),
    blocks: unknownFact(),
  };
}

function staleSnapshot(
  snapshot: WorldSnapshot,
  observedAt: string,
): WorldSnapshot {
  const stale = <T>(item: WorldFact<T>): WorldFact<T> =>
    item.status === "known" ? { ...item, status: "stale" } : item;
  return {
    ...snapshot,
    observedAt,
    position: stale(snapshot.position),
    dimension: stale(snapshot.dimension),
    gameMode: stale(snapshot.gameMode),
    health: stale(snapshot.health),
    food: stale(snapshot.food),
    oxygen: stale(snapshot.oxygen),
    inventory: stale(snapshot.inventory),
    equipment: stale(snapshot.equipment),
    entities: stale(snapshot.entities),
    blocks: stale(snapshot.blocks),
  };
}

function finitePosition(position: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} | null {
  return Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Number.isFinite(position.z)
    ? { x: position.x, y: position.y, z: position.z }
    : null;
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, 128)
    : null;
}

function isValidBlockPosition(point: {
  x: number;
  y: number;
  z: number;
}): boolean {
  return (
    Number.isSafeInteger(point.x) &&
    Number.isSafeInteger(point.y) &&
    Number.isSafeInteger(point.z) &&
    Math.abs(point.x) <= 30_000_000 &&
    point.y >= -64 &&
    point.y <= 320 &&
    Math.abs(point.z) <= 30_000_000
  );
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function observeBlocks(
  bot: Bot,
  points: readonly { x: number; y: number; z: number }[],
): BlockObservation[] | null {
  const observations: BlockObservation[] = [];
  for (const point of points) {
    const block = bot.blockAt(new Vec3(point.x, point.y, point.z), false);
    if (!block) return null;
    observations.push({ position: point, name: block.name });
  }
  return observations;
}

function inventoryFact(
  bot: Bot,
  observedAt: string,
): WorldFact<Array<{ name: string; count: number }>> {
  if (!bot.inventory)
    return fact<Array<{ name: string; count: number }>>(null, observedAt);
  const items = bot.inventory.items();
  return fact(
    items.slice(0, 128).map((item) => ({ name: item.name, count: item.count })),
    observedAt,
    items.length > 128,
  );
}

function fact<T>(
  value: T | null,
  observedAt: string,
  truncated = false,
): WorldFact<T> {
  return {
    value,
    status: value === null ? "unknown" : "known",
    source: "mineflayer",
    observedAt: value === null ? null : observedAt,
    truncated,
  };
}
