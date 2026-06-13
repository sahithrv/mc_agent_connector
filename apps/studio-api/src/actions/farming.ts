import type { Position } from "@mc-ai-video/contracts";
import { Vec3 } from "vec3";

import type { BotBlock, BotHandle, BotInventoryItem } from "../bots/types";
import { booleanParam, distance, positionParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { ActionRunContext, RegisteredAction } from "./types";

const DEFAULT_HARVEST_TIMEOUT_MS = 8_000;
const DEFAULT_PLANT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CROP_DISTANCE = 5;

interface CropDefinition {
  id: string;
  blockNames: readonly string[];
  seedNames: readonly string[];
  matureAge: number;
}

const CROPS: readonly CropDefinition[] = [
  {
    id: "wheat",
    blockNames: ["wheat", "wheat_crop"],
    seedNames: ["wheat_seeds", "seeds"],
    matureAge: 7,
  },
  {
    id: "carrot",
    blockNames: ["carrots", "carrot_crop", "carrots_crop"],
    seedNames: ["carrot"],
    matureAge: 7,
  },
  {
    id: "potato",
    blockNames: ["potatoes", "potato_crop", "potatoes_crop"],
    seedNames: ["potato"],
    matureAge: 7,
  },
  {
    id: "beetroot",
    blockNames: ["beetroots", "beetroot_crop", "beetroots_crop"],
    seedNames: ["beetroot_seeds"],
    matureAge: 3,
  },
];

export function createHarvestCropAction(): RegisteredAction {
  return {
    name: "harvest_crop",
    risk: "medium",
    timeoutMs: DEFAULT_HARVEST_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.blockAt || !context.bot.dig) {
        return { ok: false, reason: "crop harvesting is not available" };
      }
      if (!positionParam(request.params)) {
        return { ok: false, reason: "crop position required" };
      }
      return { ok: true };
    },
    async run(context) {
      const bot = context.bot;
      if (!bot?.blockAt || !bot.dig) {
        return actionFailed(context.request, context.startedAt, "crop harvesting is not available");
      }

      const target = positionParam(context.request.params);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "crop position required");
      }

      const block = bot.blockAt(target);
      if (!block) {
        return actionFailed(context.request, context.startedAt, "crop block is not visible");
      }

      const blocked = validateCropDistance(context, block.position);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      const crop = validateMatureCrop(block, requestedCropName(context.request.params));
      if (typeof crop === "string") {
        return actionFailed(context.request, context.startedAt, crop);
      }

      await bot.dig(block);

      const replantRequested = booleanParam(context.request.params, "replant") === true;
      const replant = replantRequested
        ? await tryReplant(context, crop, block.position)
        : { replanted: false };

      return actionSucceeded(context.request, context.startedAt, {
        crop: crop.id,
        block: block.name,
        position: block.position,
        replanted: replant.replanted,
        ...(replant.seed ? { seed: replant.seed } : {}),
        ...(replant.skipReason ? { replantSkipped: replant.skipReason } : {}),
      });
    },
  };
}

export function createPlantCropAction(): RegisteredAction {
  return {
    name: "plant_crop",
    risk: "medium",
    timeoutMs: DEFAULT_PLANT_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot?.blockAt || !context.bot.equip || !context.bot.placeBlock) {
        return { ok: false, reason: "crop planting is not available" };
      }
      if (!positionParam(request.params)) {
        return { ok: false, reason: "farmland position required" };
      }
      if (!findSeedItem(context.bot, request.params)) {
        return { ok: false, reason: "seed item required" };
      }
      return { ok: true };
    },
    async run(context) {
      const bot = context.bot;
      if (!bot?.blockAt || !bot.equip || !bot.placeBlock) {
        return actionFailed(context.request, context.startedAt, "crop planting is not available");
      }

      const target = positionParam(context.request.params);
      if (!target) {
        return actionFailed(context.request, context.startedAt, "farmland position required");
      }

      const seed = findSeedItem(bot, context.request.params);
      if (!seed) {
        return actionFailed(context.request, context.startedAt, "seed item required");
      }

      const farmland = resolveFarmlandTarget(bot, target);
      if (typeof farmland === "string") {
        return actionFailed(context.request, context.startedAt, farmland);
      }

      const blocked = validateCropDistance(context, farmland.position);
      if (blocked) {
        return actionFailed(context.request, context.startedAt, blocked);
      }

      await bot.equip(seed, "hand");
      await bot.placeBlock(farmland, new Vec3(0, 1, 0));

      const crop = cropForSeed(seed.name);
      return actionSucceeded(context.request, context.startedAt, {
        seed: seed.name,
        crop: crop?.id ?? seed.name,
        farmland: farmland.position,
        position: above(farmland.position),
      });
    },
  };
}

function validateMatureCrop(
  block: BotBlock,
  requestedName: string | undefined,
): CropDefinition | string {
  const crop = cropForBlock(block.name);
  if (!crop) {
    return `block is not a mature crop: ${block.name}`;
  }

  if (requestedName) {
    const requested = cropForName(requestedName);
    if (!requested || requested.id !== crop.id) {
      return `visible crop is ${block.name}, not ${requestedName}`;
    }
  }

  const age = cropAge(block);
  if (age === undefined) {
    return `crop maturity is unknown: ${block.name}`;
  }
  if (age < crop.matureAge) {
    return `crop is not mature: ${block.name} age ${age}/${crop.matureAge}`;
  }
  return crop;
}

function validateCropDistance(context: ActionRunContext, target: Position): string | undefined {
  const current = context.bot?.entity?.position;
  if (!current) {
    return undefined;
  }
  const maxDistance = DEFAULT_MAX_CROP_DISTANCE;
  if (distance(current, target) > maxDistance) {
    return `target is farther than ${maxDistance} blocks`;
  }
  return undefined;
}

async function tryReplant(
  context: ActionRunContext,
  crop: CropDefinition,
  cropPosition: Position,
): Promise<{ replanted: boolean; seed?: string; skipReason?: string }> {
  const bot = context.bot;
  if (!bot?.blockAt || !bot.equip || !bot.placeBlock) {
    return { replanted: false, skipReason: "crop planting is not available" };
  }

  const seed = findSeedItem(bot, {}, crop);
  if (!seed) {
    return { replanted: false, skipReason: `missing seed item for ${crop.id}` };
  }

  const farmland = bot.blockAt(below(cropPosition));
  if (!farmland || farmland.name !== "farmland") {
    return { replanted: false, skipReason: "farmland below crop is not visible" };
  }

  await bot.equip(seed, "hand");
  await bot.placeBlock(farmland, new Vec3(0, 1, 0));
  return { replanted: true, seed: seed.name };
}

function resolveFarmlandTarget(bot: BotHandle, target: Position): BotBlock | string {
  const direct = bot.blockAt?.(target) ?? null;
  if (direct?.name === "farmland") {
    const occupied = bot.blockAt?.(above(direct.position)) ?? null;
    if (occupied && occupied.name !== "air") {
      return `farmland is occupied by ${occupied.name}`;
    }
    return direct;
  }

  if (!direct || direct.name === "air") {
    const belowTarget = bot.blockAt?.(below(target)) ?? null;
    if (belowTarget?.name === "farmland") {
      return belowTarget;
    }
  }

  return `target must be farmland or air above farmland, got ${direct?.name ?? "unknown"}`;
}

function findSeedItem(
  bot: BotHandle,
  params: Record<string, unknown>,
  preferredCrop = cropForName(requestedCropName(params) ?? ""),
): BotInventoryItem | undefined {
  const requestedSeed = requestedSeedName(params);
  const items = bot.inventory?.items() ?? [];
  if (requestedSeed) {
    const normalized = normalizeName(requestedSeed);
    return items.find((item) => normalizeName(item.name) === normalized);
  }

  const preferred = preferredCrop
    ? items.find((item) => preferredCrop.seedNames.includes(normalizeName(item.name)))
    : undefined;
  if (preferred) {
    return preferred;
  }

  return items.find((item) => Boolean(cropForSeed(item.name)));
}

function requestedCropName(params: Record<string, unknown>): string | undefined {
  return stringParam(params, "crop")
    ?? stringParam(params, "block")
    ?? stringParam(params, "name");
}

function requestedSeedName(params: Record<string, unknown>): string | undefined {
  return stringParam(params, "seed")
    ?? stringParam(params, "item");
}

function cropForBlock(name: string): CropDefinition | undefined {
  const normalized = normalizeName(name);
  return CROPS.find((crop) => crop.blockNames.includes(normalized));
}

function cropForSeed(name: string): CropDefinition | undefined {
  const normalized = normalizeName(name);
  return CROPS.find((crop) => crop.seedNames.includes(normalized));
}

function cropForName(name: string): CropDefinition | undefined {
  const normalized = normalizeName(name);
  return CROPS.find((crop) =>
    crop.id === normalized
    || crop.blockNames.includes(normalized)
    || crop.seedNames.includes(normalized),
  );
}

function cropAge(block: BotBlock): number | undefined {
  const mature = (block as { mature?: unknown }).mature;
  if (mature === true) {
    return cropForBlock(block.name)?.matureAge;
  }
  if (mature === false) {
    return 0;
  }

  const properties = blockProperties(block);
  const propertyAge = numberValue(properties?.age);
  if (propertyAge !== undefined) {
    return propertyAge;
  }
  return numberValue((block as { metadata?: unknown }).metadata);
}

function blockProperties(block: BotBlock): Record<string, unknown> | undefined {
  const withProperties = block as {
    getProperties?: () => Record<string, unknown>;
    _properties?: Record<string, unknown>;
  };
  if (withProperties.getProperties) {
    try {
      return withProperties.getProperties();
    } catch {
      return undefined;
    }
  }
  return withProperties._properties;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function above(position: Position): Position {
  return {
    x: position.x,
    y: position.y + 1,
    z: position.z,
    world: position.world,
  };
}

function below(position: Position): Position {
  return {
    x: position.x,
    y: position.y - 1,
    z: position.z,
    world: position.world,
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
