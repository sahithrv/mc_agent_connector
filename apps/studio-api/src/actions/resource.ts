import type { Position } from "@mc-ai-video/contracts";

import type { BotBlock, BotEntity } from "../bots/types";
import { distance, numberParam, positionParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { ActionRunContext, RegisteredAction } from "./types";

const DEFAULT_COLLECT_TIMEOUT_MS = 10_000;
const DEFAULT_MINE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_COLLECT_DISTANCE = 16;
const DEFAULT_MAX_MINE_DISTANCE = 6;

const UNSAFE_BLOCKS = new Set([
  "air",
  "barrier",
  "bedrock",
  "chain_command_block",
  "command_block",
  "fire",
  "lava",
  "moving_piston",
  "repeating_command_block",
  "structure_block",
  "tnt",
  "water",
]);

export function createCollectItemAction(): RegisteredAction {
  return {
    name: "collect_item",
    risk: "medium",
    timeoutMs: DEFAULT_COLLECT_TIMEOUT_MS,
    canRun(context) {
      if (!context.bot?.collectBlock) {
        return { ok: false, reason: "collectBlock plugin is not available" };
      }
      return { ok: true };
    },
    async run(context) {
      const item = findItemEntity(context);
      if (!item) {
        return actionFailed(context.request, context.startedAt, "item is not visible");
      }
      const blocked = validateCollect(context, item);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      try {
        await collectWithAbort(context, item);
      } catch (error: unknown) {
        const message = context.signal.aborted
          ? `collect_item canceled: ${formatAbortReason(context.signal.reason)}`
          : formatError(error);
        return actionFailed(context.request, context.startedAt, message, {
          status: context.signal.aborted ? "canceled" : "failed",
        });
      }
      return actionSucceeded(context.request, context.startedAt, {
        entityId: String(item.id),
        item: item.name ?? "item",
      });
    },
  };
}

export function createMineBlockAction(): RegisteredAction {
  return {
    name: "mine_block",
    risk: "high",
    timeoutMs: DEFAULT_MINE_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.blockAt || !context.bot.dig) {
        return { ok: false, reason: "digging is not available" };
      }
      if (!positionParam(request.params)) {
        return { ok: false, reason: "block position required" };
      }
      return { ok: true };
    },
    async run(context) {
      const target = positionParam(context.request.params);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "block position required");
      }

      const block = context.bot?.blockAt?.(target);
      if (!block) {
        return actionFailed(context.request, context.startedAt, "block is not visible");
      }

      const blocked = validateMine(context, block);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      await context.bot?.dig?.(block);
      return actionSucceeded(context.request, context.startedAt, {
        block: block.name,
        position: block.position,
      });
    },
  };
}

function findItemEntity(context: ActionRunContext): BotEntity | undefined {
  const entityId = stringParam(context.request.params, "entityId");
  const itemName = stringParam(context.request.params, "item")
    ?? stringParam(context.request.params, "name");

  return Object.values(context.bot?.entities ?? {}).find((entity) => {
    const isItem = entity.kind === "item"
      || entity.type === "object"
      || entity.name === "item";
    if (!isItem) {
      return false;
    }
    if (entityId) {
      return String(entity.id) === entityId;
    }
    return !itemName || entity.name === itemName || entity.displayName === itemName;
  });
}

function validateCollect(context: ActionRunContext, item: BotEntity): string | undefined {
  if (!item.position) {
    return "item position is unknown";
  }

  const emptySlots = context.bot?.inventory?.emptySlotCount?.();
  if (emptySlots !== undefined && emptySlots <= 0) {
    return "inventory has no empty slots";
  }

  const current = context.bot?.entity?.position;
  if (current && item.position) {
    const maxDistance = context.policy?.maxCollectDistance ?? DEFAULT_MAX_COLLECT_DISTANCE;
    if (distance(current, item.position) > maxDistance) {
      return `item is farther than ${maxDistance} blocks`;
    }
  }

  return undefined;
}

async function collectWithAbort(context: ActionRunContext, item: BotEntity): Promise<void> {
  if (context.signal.aborted) {
    throw new Error(formatAbortReason(context.signal.reason));
  }

  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => {
      context.bot?.pathfinder?.stop?.();
      reject(new Error(formatAbortReason(context.signal.reason)));
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    await Promise.race([
      context.bot?.collectBlock?.collect(item),
      abort,
    ]);
  } finally {
    if (onAbort) {
      context.signal.removeEventListener("abort", onAbort);
    }
  }
}

function validateMine(context: ActionRunContext, block: BotBlock): string | undefined {
  const requestedName = stringParam(context.request.params, "block")
    ?? stringParam(context.request.params, "name");
  if (requestedName && requestedName !== block.name) {
    return `visible block is ${block.name}, not ${requestedName}`;
  }

  if (UNSAFE_BLOCKS.has(block.name)) {
    return `unsafe block cannot be mined: ${block.name}`;
  }
  if (block.position.y < 0) {
    return "unsafe block position below world floor";
  }
  if (block.diggable === false) {
    return `block is not diggable: ${block.name}`;
  }
  if (context.bot?.canDigBlock && !context.bot.canDigBlock(block)) {
    return `missing valid tool for block: ${block.name}`;
  }

  const current = context.bot?.entity?.position;
  if (current && tooFar(current, block.position, context)) {
    const maxDistance = context.policy?.maxMineDistance ?? DEFAULT_MAX_MINE_DISTANCE;
    return `block is farther than ${maxDistance} blocks`;
  }
  return undefined;
}

function tooFar(
  current: Position,
  target: Position,
  context: ActionRunContext,
): boolean {
  const maxDistance = context.policy?.maxMineDistance ?? DEFAULT_MAX_MINE_DISTANCE;
  return distance(current, target) > maxDistance;
}

function formatAbortReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }
  return "action canceled";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
