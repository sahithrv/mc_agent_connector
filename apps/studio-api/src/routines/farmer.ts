import type { JsonValue } from "@mc-ai-video/contracts";

import {
  canUseAction,
  taskEvent,
  type PerceptionSnapshot,
  type Routine,
  type RoutineAgent,
  type RoutineRunResult,
} from "./types";

export class FarmerRoutine implements Routine {
  public readonly id = "farmer";

  public run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult {
    const hasHoe = perception.inventory.tools.includes("hoe");
    const hasSeeds = perception.inventory.seeds > 0;

    if (!hasHoe || !hasSeeds) {
      return this.idle(agent, "missing_tools", {
        hasHoe,
        seeds: perception.inventory.seeds,
      });
    }

    const emptyFarmland = perception.visibleBlocks.find(
      (block) => block.type === "farmland" && block.needsPlanting && block.safe !== false,
    );
    if (emptyFarmland && canUseAction(agent, "plant_crop")) {
      return {
        status: "acting",
        action: {
          action: "plant_crop",
          params: {
            blockId: emptyFarmland.id,
            position: emptyFarmland.position,
          },
          timeoutMs: 5_000,
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "replanting crop", {
            blockId: emptyFarmland.id,
          }),
        ],
      };
    }

    const crop = perception.visibleBlocks.find(
      (block) => block.type.endsWith("_crop") && block.mature === true && block.safe !== false,
    );
    if (crop && canUseAction(agent, "harvest_crop")) {
      return {
        status: "acting",
        action: {
          action: "harvest_crop",
          params: {
            blockId: crop.id,
            position: crop.position,
            replant: hasSeeds,
          },
          timeoutMs: 8_000,
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "harvesting mature crop", {
            blockId: crop.id,
          }),
        ],
      };
    }

    return this.idle(agent, "no_ready_crops", {});
  }

  private idle(
    agent: RoutineAgent,
    reason: string,
    payload: Record<string, JsonValue>,
  ): RoutineRunResult {
    return {
      status: "idle",
      reason,
      action: canUseAction(agent, "idle")
        ? {
            action: "idle",
            params: { reason },
            timeoutMs: 1_000,
          }
        : undefined,
      taskEvents: [taskEvent(agent, this.id, "idle", reason, payload)],
    };
  }
}
