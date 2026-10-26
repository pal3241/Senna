import { z } from "zod";
import type { MinecraftAdapter } from "../adapters/minecraft/minecraft-adapter.js";
import type { ActionCoordinator } from "./action-coordinator.js";

export const moveTargetSchema = z.object({
  x: z.number().int().min(-30_000_000).max(30_000_000),
  y: z.number().int().min(-64).max(320),
  z: z.number().int().min(-30_000_000).max(30_000_000),
});

export type MoveTarget = z.infer<typeof moveTargetSchema>;

export interface MoveEvidence {
  target: MoveTarget;
  start: { x: number; y: number; z: number };
  final: { x: number; y: number; z: number };
  distance: number;
  observedAt: string;
}

const maxMoveDistance = 48;
const arrivalTolerance = 1.75;

export class GameplayActions {
  constructor(
    private readonly coordinator: ActionCoordinator,
    private readonly minecraft: MinecraftAdapter,
  ) {}

  moveTo(
    taskId: string,
    owner: string,
    targetInput: unknown,
    signal?: AbortSignal,
  ) {
    const target = moveTargetSchema.parse(targetInput);
    let start: MoveEvidence["start"] | null = null;
    let verified: MoveEvidence | null = null;
    return this.coordinator
      .execute<MoveEvidence>({
        taskId,
        owner,
        kind: "minecraft.move_to",
        resources: ["movement"],
        timeoutMs: 120_000,
        ...(signal ? { signal } : {}),
        precondition: () => {
          const snapshot = this.minecraft.getWorldSnapshot();
          if (
            snapshot.connection !== "spawned" ||
            snapshot.position.status !== "known" ||
            !snapshot.position.value
          )
            return false;
          if (!this.minecraft.isMovementReady()) return false;
          start = snapshot.position.value;
          return distance(start, target) <= maxMoveDistance;
        },
        run: async (actionSignal) => {
          if (!start) throw new Error("move-precondition-position-missing");
          await this.minecraft.moveTo(target, actionSignal);
          return {
            target,
            start,
            final: start,
            distance: 0,
            observedAt: new Date().toISOString(),
          };
        },
        verify: (evidence) => {
          const snapshot = this.minecraft.getWorldSnapshot();
          const final = snapshot.position.value;
          if (
            snapshot.connection !== "spawned" ||
            snapshot.position.status !== "known" ||
            !final
          )
            return false;
          const remainingDistance = distance(final, target);
          if (remainingDistance > arrivalTolerance) return false;
          verified = {
            ...evidence,
            final,
            distance: remainingDistance,
            observedAt:
              snapshot.position.observedAt ?? new Date().toISOString(),
          };
          return true;
        },
        cleanup: (reason) => {
          if (reason !== "success") this.minecraft.stopMovement();
        },
      })
      .then((result) => {
        if (!verified) throw new Error("move-verification-evidence-missing");
        return { ...result, result: verified };
      });
  }
}

function distance(
  a: { x: number; y: number; z: number },
  b: MoveTarget,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
