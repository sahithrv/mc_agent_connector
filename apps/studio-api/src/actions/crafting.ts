import type { BotBlock, BotHandle } from "../bots/types";
import { booleanParam, numberParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type { RegisteredAction } from "./types";

const minecraftData = require("minecraft-data") as (version: string) => MinecraftData;

const DEFAULT_CRAFT_TIMEOUT_MS = 8_000;
const DEFAULT_MC_VERSION = "1.21.1";
const MAX_CRAFT_COUNT = 16;

interface MinecraftData {
  itemsByName: Record<string, MinecraftItem | undefined>;
  blocksByName: Record<string, MinecraftItem | undefined>;
}

interface MinecraftItem {
  id: number;
  name: string;
  displayName?: string;
}

const ITEM_ALIASES: Record<string, string> = {
  planks: "oak_planks",
  wood_planks: "oak_planks",
  wood: "oak_planks",
  table: "crafting_table",
  workbench: "crafting_table",
  wood_pickaxe: "wooden_pickaxe",
  wood_axe: "wooden_axe",
  wood_sword: "wooden_sword",
  wood_shovel: "wooden_shovel",
  stone: "stone",
};

export function createCraftItemAction(): RegisteredAction {
  return {
    name: "craft_item",
    risk: "medium",
    timeoutMs: DEFAULT_CRAFT_TIMEOUT_MS,
    canRun(context, request) {
      if (!hasCrafting(context.bot)) {
        return { ok: false, reason: "crafting is not available" };
      }
      if (!requestedItemName(request.params)) {
        return { ok: false, reason: "item name required" };
      }
      return { ok: true };
    },
    async run(context) {
      const bot = context.bot;
      if (!hasCrafting(bot)) {
        return actionFailed(context.request, context.startedAt, "crafting is not available");
      }

      const requestedName = requestedItemName(context.request.params);
      if (!requestedName) {
        return actionFailed(context.request, context.startedAt, "item name required");
      }

      const data = minecraftData(bot.version ?? DEFAULT_MC_VERSION);
      const item = resolveCraftItem(data, requestedName);
      if (!item) {
        return actionFailed(context.request, context.startedAt, `unknown craft item: ${requestedName}`);
      }

      const count = Math.max(1, Math.min(MAX_CRAFT_COUNT, Math.floor(numberParam(context.request.params, "count") ?? 1)));
      const craftingTable = booleanParam(context.request.params, "useCraftingTable") === false
        ? null
        : findNearbyCraftingTable(bot, data);
      const recipes = bot.recipesFor(item.id, null, 1, craftingTable);
      if (!recipes.length) {
        return actionFailed(context.request, context.startedAt, `no craftable recipe for ${item.name}`, {
          item: item.name,
          usedCraftingTable: Boolean(craftingTable),
        });
      }

      await bot.craft(recipes[0], count, craftingTable);
      return actionSucceeded(context.request, context.startedAt, {
        item: item.name,
        count,
        usedCraftingTable: Boolean(craftingTable),
      });
    },
  };
}

function requestedItemName(params: Record<string, unknown>): string | undefined {
  return stringParam(params, "item")
    ?? stringParam(params, "name")
    ?? stringParam(params, "block");
}

function resolveCraftItem(data: MinecraftData, requestedName: string): MinecraftItem | undefined {
  const normalized = normalizeItemName(requestedName);
  const canonical = ITEM_ALIASES[normalized] ?? normalized;
  return data.itemsByName[canonical] ?? data.blocksByName[canonical];
}

function findNearbyCraftingTable(bot: BotHandle, data: MinecraftData): BotBlock | null {
  const tableId = data.blocksByName.crafting_table?.id;
  if (tableId === undefined || !bot.findBlock) {
    return null;
  }
  return bot.findBlock({ matching: tableId, maxDistance: 4 }) ?? null;
}

function hasCrafting(bot: BotHandle | undefined): bot is BotHandle & {
  craft(recipe: unknown, count: number, craftingTable?: BotBlock | null): Promise<void>;
  recipesFor(itemType: number, metadata?: number | null, minResultCount?: number, craftingTable?: BotBlock | null): unknown[];
} {
  return Boolean(bot && typeof bot.craft === "function" && typeof bot.recipesFor === "function");
}

function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
