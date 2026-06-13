import type { JsonValue } from "@mc-ai-video/contracts";

import {
  canUseAction,
  taskEvent,
  type PerceptionSnapshot,
  type Routine,
  type RoutineAgent,
  type RoutineRunResult,
} from "./types";

const MAX_SEED_DROP_DISTANCE = 12;

export class FarmerRoutine implements Routine {
  public readonly id = "farmer";

  public run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult {
    const hasHoe = perception.inventory.tools.some((tool) => /hoe/i.test(tool));
    const hasSeeds = perception.inventory.seeds > 0;

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
            reason: "mature_crop_visible",
            blockId: crop.id,
          }),
        ],
      };
    }

    if (!hasHoe && canUseAction(agent, "craft_item")) {
      return {
        status: "acting",
        action: {
          action: "craft_item",
          params: {
            item: "wooden_hoe",
            count: 1,
            reason: "farmer needs a hoe before planting",
          },
          timeoutMs: 8_000,
          requestedBy: "farmer-routine",
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "crafting hoe for farming", {
            reason: "missing_tool",
            tool: "hoe",
          }),
        ],
      };
    }

    if (!hasSeeds) {
      const seedDrop = perception.nearbyEntities.find(isSeedDrop);
      if (seedDrop && canUseAction(agent, "collect_item")) {
        return {
          status: "acting",
          action: {
            action: "collect_item",
            params: {
              entityId: seedDrop.id,
              item: seedDrop.type,
              reason: "collecting seeds or crops for farming",
            },
            timeoutMs: 10_000,
            requestedBy: "farmer-routine",
          },
          taskEvents: [
            taskEvent(agent, this.id, "acting", "collecting seed or crop drop", {
              reason: "missing_material",
              item: seedDrop.type,
            }),
          ],
        };
      }

      const seedSource = perception.visibleBlocks.find((block) =>
        /grass|fern|wheat|carrot|potato|beetroot/i.test(block.type)
        && block.safe !== false
        && block.belowAgent !== true,
      );
      if (seedSource && canUseAction(agent, "mine_block")) {
        return {
          status: "acting",
          action: {
            action: "mine_block",
            params: {
              position: seedSource.position,
              block: seedSource.type,
              reason: "gathering seeds or crop starts for farming",
            },
            timeoutMs: 10_000,
            requestedBy: "farmer-routine",
          },
          taskEvents: [
            taskEvent(agent, this.id, "acting", "gathering seed source", {
              reason: "missing_material",
              blockId: seedSource.id,
              blockType: seedSource.type,
            }),
          ],
        };
      }
    }

    if (!hasHoe || !hasSeeds) {
      return this.idle(agent, "missing_tools", {
        reason: !hasHoe ? "missing_tool" : "missing_material",
        hasHoe,
        seeds: perception.inventory.seeds,
      }, true);
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
            reason: "empty_farmland_visible",
            blockId: emptyFarmland.id,
          }),
        ],
      };
    }

    return this.idle(agent, "no_ready_crops", { reason: "no_ready_crops" });
  }

  private idle(
    agent: RoutineAgent,
    reason: string,
    payload: Record<string, JsonValue>,
    wantsPlanning = false,
  ): RoutineRunResult {
    return {
      status: "idle",
      reason,
      wantsPlanning,
      taskEvents: [taskEvent(agent, this.id, "idle", reason, payload)],
    };
  }
}

function isSeedDrop(entity: PerceptionSnapshot["nearbyEntities"][number]): boolean {
  if (!entity.id || entity.hostile === true || !entity.position) {
    return false;
  }
  return /seed|wheat|carrot|potato|beetroot/i.test(entity.type)
    && (entity.distance === undefined || entity.distance <= MAX_SEED_DROP_DISTANCE);
}
