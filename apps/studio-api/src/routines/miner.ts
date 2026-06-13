import {
  canUseAction,
  taskEvent,
  type PerceptionSnapshot,
  type Routine,
  type RoutineAgent,
  type RoutineRunResult,
} from "./types";

const COMMON_MINEABLE_BLOCKS = new Set([
  "stone",
  "deepslate",
  "coal_ore",
  "iron_ore",
  "copper_ore",
  "gravel",
  "dirt",
]);

export class MinerRoutine implements Routine {
  public readonly id = "miner";

  public run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult {
    const danger = perception.nearbyEntities.find((entity) => entity.hostile);
    if (danger || perception.health <= 8) {
      return {
        status: "failed",
        reason: "danger_detected",
        wantsPlanning: true,
        taskEvents: [
          taskEvent(
            agent,
            this.id,
            "failed",
            "mining stopped because danger was detected",
            { entityId: danger?.id ?? "low_health" },
            4,
          ),
        ],
      };
    }

    const block = perception.visibleBlocks.find(
      (candidate) =>
        COMMON_MINEABLE_BLOCKS.has(candidate.type) &&
        candidate.safe !== false &&
        candidate.belowAgent !== true,
    );

    if (!block || !canUseAction(agent, "mine_block")) {
      return {
        status: "idle",
        reason: block ? "mine_block_not_allowed" : "no_safe_visible_block",
        taskEvents: [
          taskEvent(agent, this.id, "idle", block ? "mine block action not allowed" : "no safe visible block to mine", {
            reason: block ? "action_not_allowed" : "no_safe_target",
            ...(block ? { blockId: block.id, blockType: block.type } : {}),
          }),
        ],
      };
    }

    return {
      status: "acting",
      action: {
        action: "mine_block",
        params: {
          blockId: block.id,
          position: block.position,
        },
        timeoutMs: 10_000,
      },
      taskEvents: [
        taskEvent(agent, this.id, "acting", "mining safe visible block", {
          blockId: block.id,
          blockType: block.type,
        }),
      ],
    };
  }
}
