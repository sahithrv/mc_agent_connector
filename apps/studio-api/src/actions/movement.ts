import type { Position } from "@mc-ai-video/contracts";
import { goals } from "mineflayer-pathfinder";

import type { BotEntity, BotHandle, BotPathfinder } from "../bots/types";
import { distance, numberParam, positionParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { ActionRunContext, RegisteredAction } from "./types";

const DEFAULT_MOVE_TIMEOUT_MS = 15_000;
const DEFAULT_FOLLOW_TIMEOUT_MS = 30_000;
const DEFAULT_FLEE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_MOVE_DISTANCE = 128;

export function createMoveToAction(): RegisteredAction {
  return {
    name: "move_to",
    risk: "medium",
    timeoutMs: DEFAULT_MOVE_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.pathfinder) {
        return { ok: false, reason: "pathfinder is not available" };
      }
      if (!positionParam(request.params)) {
        return { ok: false, reason: "target position required" };
      }
      return { ok: true };
    },
    async run(context) {
      const target = positionParam(context.request.params);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "target position required");
      }
      const blocked = validateMoveDistance(context, target);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      const range = numberParam(context.request.params, "range") ?? 1;
      const result = await startGoal(context, new goals.GoalNear(target.x, target.y, target.z, range));
      return result ?? actionSucceeded(context.request, context.startedAt, { reached: true });
    },
  };
}

export function createFollowPlayerAction(): RegisteredAction {
  return {
    name: "follow_player",
    risk: "medium",
    timeoutMs: DEFAULT_FOLLOW_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.pathfinder) {
        return { ok: false, reason: "pathfinder is not available" };
      }
      if (!targetUsername(request)) {
        return { ok: false, reason: "target player required" };
      }
      return { ok: true };
    },
    async run(context) {
      const username = targetUsername(context.request);
      const target = username ? findPlayer(context.bot, username) : undefined;
      if (!username || !target) {
        return actionFailed(context.request, context.startedAt, "target player not visible");
      }

      const range = numberParam(context.request.params, "range") ?? 3;
      const result = await startGoal(context, new goals.GoalFollow(target as never, range));
      return result ?? actionSucceeded(context.request, context.startedAt, { followed: username });
    },
  };
}

export function createFleeAction(): RegisteredAction {
  return {
    name: "flee",
    risk: "medium",
    timeoutMs: DEFAULT_FLEE_TIMEOUT_MS,
    canRun(context) {
      if (!context.bot?.pathfinder) {
        return { ok: false, reason: "pathfinder is not available" };
      }
      if (!context.bot.entity?.position) {
        return { ok: false, reason: "bot position is unknown" };
      }
      return { ok: true };
    },
    async run(context) {
      const current = context.bot?.entity?.position;
      const origin = fleeOrigin(context);
      if (!current || !origin) {
        return actionFailed(context.request, context.startedAt, "flee origin not visible");
      }

      const target = safeFleeTarget(current, origin, numberParam(context.request.params, "distance") ?? 16);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "no safe flee goal found");
      }

      const result = await startGoal(context, new goals.GoalNear(target.x, target.y, target.z, 2));
      return result ?? actionSucceeded(context.request, context.startedAt, { target });
    },
  };
}

async function startGoal(context: ActionRunContext, goal: unknown) {
  const pathfinder = context.bot?.pathfinder;
  if (!pathfinder) {
    return actionFailed(context.request, context.startedAt, "pathfinder is not available");
  }

  const stopOnAbort = (): void => pathfinder.stop?.();
  context.signal.addEventListener("abort", stopOnAbort, { once: true });
  try {
    await pathfinder.goto(goal);
    return undefined;
  } catch (error) {
    return actionFailed(context.request, context.startedAt, pathError(error));
  } finally {
    context.signal.removeEventListener("abort", stopOnAbort);
  }
}

function validateMoveDistance(context: ActionRunContext, target: Position): string | undefined {
  const current = context.bot?.entity?.position;
  if (!current) {
    return undefined;
  }
  const maxDistance = context.policy?.maxMoveDistance ?? DEFAULT_MAX_MOVE_DISTANCE;
  if (distance(current, target) > maxDistance) {
    return `target is farther than ${maxDistance} blocks`;
  }
  return undefined;
}

function targetUsername(request: { params: Record<string, unknown> }): string | undefined {
  return stringParam(request.params, "username")
    ?? stringParam(request.params, "player")
    ?? stringParam(request.params, "target");
}

function findPlayer(bot: BotHandle | undefined, username: string): BotEntity | undefined {
  return Object.values(bot?.entities ?? {}).find((entity) =>
    entity.type === "player" && entity.username === username,
  );
}

function fleeOrigin(context: ActionRunContext): Position | undefined {
  const direct = positionParam(context.request.params);
  if (direct) {
    return direct;
  }

  const username = targetUsername(context.request);
  if (username) {
    return findPlayer(context.bot, username)?.position;
  }

  const entityId = stringParam(context.request.params, "entityId");
  return Object.values(context.bot?.entities ?? {}).find((entity) =>
    String(entity.id) === entityId,
  )?.position;
}

function safeFleeTarget(
  current: Position,
  origin: Position,
  fleeDistance: number,
): Position | undefined {
  const dx = current.x - origin.x;
  const dz = current.z - origin.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length === 0 || fleeDistance <= 0) {
    return undefined;
  }

  return {
    x: current.x + (dx / length) * fleeDistance,
    y: current.y,
    z: current.z + (dz / length) * fleeDistance,
    world: current.world,
  };
}

function pathError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return `pathfinder failed: ${String(error)}`;
}
