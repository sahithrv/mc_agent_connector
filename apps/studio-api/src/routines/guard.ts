import {
  canUseAction,
  taskEvent,
  type PerceptionSnapshot,
  type Routine,
  type RoutineAgent,
  type RoutineRunResult,
} from "./types";

export class GuardRoutine implements Routine {
  public readonly id = "guard";

  public run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult {
    const threateningPlayer = perception.nearbyPlayers.find((player) => player.threatening);
    if (threateningPlayer) {
      return this.warn(agent, threateningPlayer.id);
    }

    const hostile = perception.nearbyEntities.find(
      (entity) => entity.hostile && entity.type !== "player" && entity.protected !== true,
    );
    if (hostile && perception.health <= 8 && canUseAction(agent, "flee")) {
      return {
        status: "acting",
        action: {
          action: "flee",
          params: { entityId: hostile.id },
          timeoutMs: 8_000,
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "fleeing hostile mob while injured", {
            entityId: hostile.id,
          }),
        ],
      };
    }

    if (hostile && canUseAction(agent, "attack_entity")) {
      return {
        status: "acting",
        action: {
          action: "attack_entity",
          params: { entityId: hostile.id, entityType: hostile.type },
          timeoutMs: 8_000,
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "engaging hostile mob", {
            entityId: hostile.id,
          }),
        ],
      };
    }

    const patrolPoint = perception.patrolPoints?.[0];
    if (patrolPoint && canUseAction(agent, "move_to")) {
      return {
        status: "acting",
        action: {
          action: "move_to",
          params: { position: patrolPoint },
          timeoutMs: 12_000,
        },
        taskEvents: [
          taskEvent(agent, this.id, "acting", "patrolling guard area", {
            position: patrolPoint,
          }),
        ],
      };
    }

    return {
      status: "idle",
      reason: "area_clear",
      action: canUseAction(agent, "idle")
        ? {
            action: "idle",
            params: { reason: "area_clear" },
            timeoutMs: 1_000,
          }
        : undefined,
      taskEvents: [taskEvent(agent, this.id, "idle", "guard area clear", {})],
    };
  }

  private warn(agent: RoutineAgent, playerId: string): RoutineRunResult {
    return {
      status: "acting",
      action: canUseAction(agent, "chat_public")
        ? {
            action: "chat_public",
            params: { content: "Step back from protected players.", targetId: playerId },
            timeoutMs: 2_000,
          }
        : undefined,
      taskEvents: [
        taskEvent(agent, this.id, "acting", "warning instead of attacking player", {
          playerId,
        }),
      ],
    };
  }
}
