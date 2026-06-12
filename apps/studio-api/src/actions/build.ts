import { Vec3 } from "vec3";

import type { BotBlock, BotHandle } from "../bots/types";
import { positionParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { ActionRunContext, RegisteredAction } from "./types";

const DEFAULT_PLACE_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_PLACE_DISTANCE = 5;
const BLOCKED_PLACE_NAMES = new Set(["air", "bedrock", "barrier", "command_block", "structure_block"]);

export function createPlaceBlockAction(): RegisteredAction {
  return {
    name: "place_block",
    risk: "medium",
    timeoutMs: DEFAULT_PLACE_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.blockAt || !hasPlaceBlock(context.bot)) {
        return { ok: false, reason: "block placement is not available" };
      }
      if (!positionParam(request.params)) {
        return { ok: false, reason: "target position required" };
      }
      return { ok: true };
    },
    async run(context) {
      const bot = context.bot;
      if (!bot?.blockAt || !bot.placeBlock || !bot.equip) {
        return actionFailed(context.request, context.startedAt, "block placement is not available");
      }
      const current = bot.entity?.position;
      const target = positionParam(context.request.params) ?? (current
        ? { x: Math.floor(current.x) + 1, y: Math.floor(current.y), z: Math.floor(current.z) }
        : undefined);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "target position required");
      }

      const blockName = stringParam(context.request.params, "block")
        ?? stringParam(context.request.params, "name")
        ?? stringParam(context.request.params, "item")
        ?? firstSafeBlockItem(bot);
      if (!blockName || BLOCKED_PLACE_NAMES.has(blockName)) {
        return actionFailed(context.request, context.startedAt, "safe block item required");
      }

      const item = bot.inventory?.items().find((candidate) => candidate.name === blockName);
      if (!item) {
        return actionFailed(context.request, context.startedAt, `missing block item: ${blockName}`);
      }

      if (current && distance(current, target) > DEFAULT_MAX_PLACE_DISTANCE) {
        return actionFailed(context.request, context.startedAt, `target is farther than ${DEFAULT_MAX_PLACE_DISTANCE} blocks`);
      }

      const reference = findReferenceBlock(context, target);
      if (!reference) {
        return actionFailed(context.request, context.startedAt, "no adjacent reference block for placement");
      }

      await bot.equip(item, "hand");
      await bot.placeBlock(reference.block, reference.face);
      return actionSucceeded(context.request, context.startedAt, {
        block: blockName,
        position: target,
      });
    },
  };
}

interface PlaceReference {
  block: BotBlock;
  face: Vec3;
}

function findReferenceBlock(context: ActionRunContext, target: { x: number; y: number; z: number }): PlaceReference | undefined {
  const candidates = [
    { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
    { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
    { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
    { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
    { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
  ];

  for (const candidate of candidates) {
    const position = {
      x: target.x + candidate.offset.x,
      y: target.y + candidate.offset.y,
      z: target.z + candidate.offset.z,
    };
    const block = context.bot?.blockAt?.(position);
    if (block && block.name !== "air") {
      return { block, face: candidate.face };
    }
  }
  return undefined;
}

function hasPlaceBlock(bot: BotHandle | undefined): bot is BotHandle & { placeBlock(block: BotBlock, face: Vec3): Promise<void> } {
  return Boolean(bot && typeof bot.placeBlock === "function");
}

function firstSafeBlockItem(bot: BotHandle): string | undefined {
  return bot.inventory?.items()
    .map((item) => item.name)
    .find((name) =>
      !BLOCKED_PLACE_NAMES.has(name) &&
      /dirt|cobblestone|stone|planks|log|wood|brick|sand|gravel|glass/i.test(name),
    );
}

function distance(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
