import {
  canUseAction,
  taskEvent,
  type PerceptionSnapshot,
  type Routine,
  type RoutineAgent,
  type RoutineRunResult,
} from "./types";

const USEFUL_DROP_PATTERN =
  /seed|wheat|carrot|potato|apple|bread|beef|pork|chicken|mutton|log|wood|planks|stick|cobblestone|stone|ore|ingot|coal|torch|tool|sword|pickaxe|axe|shovel|hoe/i;
const MAX_ROUTINE_COLLECT_DISTANCE = 12;

export class SurvivalRoutine implements Routine {
  public readonly id = "survival";

  public run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult {
    const hostile = perception.nearbyEntities.find((entity) =>
      entity.hostile === true && entity.type !== "player" && entity.protected !== true,
    );

    if (hostile && perception.health <= 8 && canUseAction(agent, "flee")) {
      return {
        status: "acting",
        action: {
          action: "flee",
          params: {
            entityId: hostile.id,
            reason: "low health with hostile nearby",
          },
          timeoutMs: 8_000,
          requestedBy: "routine-survival",
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "fleeing hostile while injured", {
            reason: "hostile_nearby_low_health",
            entityId: hostile.id,
            entityType: hostile.type,
          }, 4),
        ],
      };
    }

    if (hostile && canUseAction(agent, "attack_entity")) {
      return {
        status: "acting",
        action: {
          action: "attack_entity",
          params: {
            entityId: hostile.id,
            entityType: hostile.type,
            reason: "hostile nearby",
          },
          timeoutMs: 8_000,
          requestedBy: "routine-survival",
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "engaging nearby hostile", {
            reason: "hostile_nearby",
            entityId: hostile.id,
            entityType: hostile.type,
          }, 4),
        ],
      };
    }

    if (hostile) {
      return {
        status: "failed",
        reason: "hostile_nearby_no_safe_action",
        wantsPlanning: true,
        taskEvents: [
          taskEvent(agent, this.id, "failed", "hostile nearby but no flee or attack action is available", {
            reason: "action_not_allowed",
            entityId: hostile.id,
            entityType: hostile.type,
          }, 4),
        ],
      };
    }

    const usefulDrop = perception.nearbyEntities.find(isUsefulDrop);
    if (usefulDrop && canUseAction(agent, "collect_item")) {
      return {
        status: "acting",
        action: {
          action: "collect_item",
          params: {
            entityId: usefulDrop.id,
            item: usefulDrop.type,
            reason: "collecting useful nearby dropped item",
          },
          timeoutMs: 10_000,
          requestedBy: "routine-survival",
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "collecting useful dropped item", {
            reason: "useful_drop_nearby",
            entityId: usefulDrop.id,
            item: usefulDrop.type,
          }),
        ],
      };
    }

    return {
      status: "idle",
      reason: "no_survival_action",
      taskEvents: [],
    };
  }
}

function isUsefulDrop(entity: PerceptionSnapshot["nearbyEntities"][number]): boolean {
  if (!entity.id || entity.hostile === true || !entity.position) {
    return false;
  }
  const normalizedType = entity.type.trim().toLowerCase();
  return normalizedType !== "item"
    && normalizedType !== "object"
    && normalizedType !== "dropped_item"
    && USEFUL_DROP_PATTERN.test(normalizedType)
    && (entity.distance === undefined || entity.distance <= MAX_ROUTINE_COLLECT_DISTANCE);
}
