import type { BotEntity } from "../bots/types";
import { booleanParam, numberParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { ActionRunContext, RegisteredAction } from "./types";

const DEFAULT_ATTACK_TIMEOUT_MS = 5_000;

const DEFAULT_HOSTILE_TARGETS = new Set([
  "blaze",
  "creeper",
  "drowned",
  "enderman",
  "endermite",
  "ghast",
  "guardian",
  "hoglin",
  "magma_cube",
  "phantom",
  "pillager",
  "ravager",
  "skeleton",
  "slime",
  "spider",
  "vex",
  "witch",
  "wither_skeleton",
  "zombie",
]);

export function createAttackEntityAction(): RegisteredAction {
  return {
    name: "attack_entity",
    risk: "high",
    timeoutMs: DEFAULT_ATTACK_TIMEOUT_MS,
    canRun(context) {
      if (!context.bot?.attack) {
        return { ok: false, reason: "attacking is not available" };
      }
      return { ok: true };
    },
    async run(context) {
      const target = findTarget(context);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "target entity not visible");
      }

      const blocked = validateTarget(context, target);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      await Promise.resolve(context.bot?.attack?.(target));
      return actionSucceeded(context.request, context.startedAt, {
        entityId: String(target.id),
        target: target.username ?? target.name ?? target.mobType ?? "entity",
      });
    },
  };
}

function findTarget(context: ActionRunContext): BotEntity | undefined {
  const entityId = stringParam(context.request.params, "entityId")
    ?? numberParam(context.request.params, "entityId")?.toString();
  const username = stringParam(context.request.params, "username");
  const name = stringParam(context.request.params, "name")
    ?? stringParam(context.request.params, "target");

  return Object.values(context.bot?.entities ?? {}).find((entity) => {
    if (entityId && String(entity.id) === entityId) {
      return true;
    }
    if (username && entity.username === username) {
      return true;
    }
    return Boolean(name && targetName(entity) === name);
  });
}

function validateTarget(
  context: ActionRunContext,
  target: BotEntity,
): string | undefined {
  const override = hasDirectorOverride(context);
  const username = target.username?.toLowerCase();

  if (target.username === context.agent.account.username) {
    return "friendly-fire guard blocked self target";
  }

  const protectedPlayers = new Set(
    (context.policy?.protectedPlayerUsernames ?? []).map((name) => name.toLowerCase()),
  );
  if (username && protectedPlayers.has(username) && !override) {
    return "protected player target requires director override";
  }

  const targetTeam = username ? context.policy?.playerTeams?.[username] : undefined;
  if (targetTeam && context.agent.team && targetTeam === context.agent.team && !override) {
    return "friendly-fire guard blocked same-team target";
  }

  if (isPlayer(target) && !override) {
    return "player targets require director override";
  }

  const name = targetName(target);
  const allowed = new Set([
    ...DEFAULT_HOSTILE_TARGETS,
    ...(context.policy?.allowedAttackEntityNames ?? []),
  ]);
  if (!allowed.has(name) && !override) {
    return `attack target is not allowed: ${name || "unknown"}`;
  }

  return undefined;
}

function hasDirectorOverride(context: ActionRunContext): boolean {
  return context.policy?.allowDirectorAttackOverride === true
    && context.request.requestedBy === "director"
    && booleanParam(context.request.params, "directorOverride") === true;
}

function isPlayer(entity: BotEntity): boolean {
  return entity.type === "player" || entity.username !== undefined;
}

function targetName(entity: BotEntity): string {
  return (entity.name ?? entity.mobType ?? entity.displayName ?? "").toLowerCase();
}
