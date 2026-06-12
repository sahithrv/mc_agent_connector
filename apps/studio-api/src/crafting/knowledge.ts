import type { MemoryContext } from "../llm/prompts";

const minecraftData = require("minecraft-data") as (version: string) => MinecraftData;

const DEFAULT_MC_VERSION = "1.21.1";
const MAX_RECIPE_VARIANTS = 3;

export interface CraftingRecipeSummary {
  output: string;
  outputCount: number;
  ingredients: string[];
}

export type CraftingRecipeDictionary = Record<string, CraftingRecipeSummary[]>;

interface MinecraftData {
  itemsByName: Record<string, MinecraftItem | undefined>;
  blocksByName: Record<string, MinecraftItem | undefined>;
  items: Record<number, MinecraftItem | undefined>;
  blocks: Record<number, MinecraftItem | undefined>;
  recipes: Record<number, MinecraftRecipe[] | undefined>;
}

interface MinecraftItem {
  id: number;
  name: string;
  displayName?: string;
}

interface MinecraftRecipe {
  inShape?: Array<Array<number | null>>;
  ingredients?: number[];
  result?: {
    id: number;
    count?: number;
  };
}

const RECIPE_CACHE = new Map<string, CraftingRecipeDictionary>();

const COMMON_RECIPE_KEYS = [
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "stick",
  "crafting_table",
  "wooden_axe",
  "wooden_pickaxe",
  "wooden_sword",
  "wooden_shovel",
  "stone_axe",
  "stone_pickaxe",
  "stone_sword",
  "stone_shovel",
  "furnace",
  "torch",
  "chest",
  "barrel",
  "oak_door",
  "oak_fence",
  "oak_fence_gate",
  "ladder",
  "bread",
  "hay_block",
  "shield",
  "campfire",
  "glass",
];

const KEYWORD_RECIPE_HINTS: Array<{ pattern: RegExp; keys: string[] }> = [
  { pattern: /\b(house|hut|home|shelter|roof|wall|door|window)\b/i, keys: ["oak_planks", "stick", "crafting_table", "oak_door", "glass", "torch", "chest"] },
  { pattern: /\b(village|base|camp|settlement)\b/i, keys: ["crafting_table", "chest", "furnace", "torch", "oak_fence", "oak_door", "campfire"] },
  { pattern: /\b(tool|tools|pickaxe|axe|shovel|sword|mine|mining)\b/i, keys: ["stick", "crafting_table", "wooden_pickaxe", "wooden_axe", "stone_pickaxe", "stone_axe", "furnace", "torch"] },
  { pattern: /\b(food|farm|bread|wheat|crop)\b/i, keys: ["bread", "hay_block", "chest", "oak_fence", "composter"] },
  { pattern: /\b(fight|kill|attack|defend|weapon|shield)\b/i, keys: ["wooden_sword", "stone_sword", "shield", "bread", "torch"] },
];

export const LAYOUT_INSTRUCTION_GUIDES: Record<string, string> = {
  build_house:
    "Build a small safe shelter first: floor, four walls, a doorway, roof, and torches. Use local blocks creatively, keep it compact, and leave room for a chest or crafting table.",
  build_village:
    "Create a shared village center, then add small role-based buildings around it. Leaders should split work into gathering, tools, safety, and construction while builders place simple shelters and paths.",
  build_base:
    "Start with a defensible central storage and crafting area, then add walls, lighting, and clear entrances. Prioritize safety and supply access before decorative details.",
  build_farm:
    "Flatten a small area near water if possible, protect it with fences or blocks, and keep paths open. Farmers should gather seeds/food, place storage nearby, and ask miners for tools.",
  build_mine:
    "Make a safe mine entrance with lights and a visible route back to base. Miners should craft pickaxes first, dig gradually, and report useful ores or hazards.",
  craft_tools:
    "Craft planks and sticks before tools; make a crafting table if the recipe needs a 3x3 grid. Upgrade from wooden to stone tools after collecting cobblestone or similar stone.",
  find_player:
    "Coordinate sightings through team chat, follow visible targets before attacking, and avoid splitting too far from your leader. Only attack the named real player when the director goal explicitly allows it.",
};

export function buildCraftingRecipeDictionary(version = DEFAULT_MC_VERSION): CraftingRecipeDictionary {
  const cached = RECIPE_CACHE.get(version);
  if (cached) {
    return cached;
  }

  const data = minecraftData(version);
  const dictionary: CraftingRecipeDictionary = {};
  for (const item of Object.values(data.itemsByName)) {
    if (!item) continue;
    const recipes = data.recipes[item.id] ?? [];
    const summaries = recipes
      .map((recipe) => summarizeRecipe(data, item.name, recipe))
      .filter((summary): summary is CraftingRecipeSummary => Boolean(summary));
    if (summaries.length > 0) {
      dictionary[item.name] = dedupeRecipes(summaries).slice(0, MAX_RECIPE_VARIANTS);
    }
  }

  RECIPE_CACHE.set(version, dictionary);
  return dictionary;
}

export function recipeKnowledgeMemories(input: {
  goal?: string;
  task?: string;
  role?: string;
  inventoryItemNames?: string[];
  version?: string;
}): MemoryContext[] {
  const dictionary = buildCraftingRecipeDictionary(input.version);
  const selectedKeys = selectRecipeKeys(input, dictionary);
  const recipeSummary = selectedKeys
    .map((key) => formatRecipeKnowledge(key, dictionary[key]))
    .filter((line): line is string => Boolean(line))
    .slice(0, 12);
  const layoutSummary = selectLayoutGuides(`${input.goal ?? ""} ${input.task ?? ""} ${input.role ?? ""}`);

  const memories: MemoryContext[] = [];
  if (recipeSummary.length > 0) {
    memories.push({
      id: "crafting-recipes",
      summary: `Relevant crafting recipes: ${recipeSummary.join("; ")}`,
      importance: 5,
    });
  }
  if (layoutSummary.length > 0) {
    memories.push({
      id: "layout-guidance",
      summary: `Creative build guidance: ${layoutSummary.join(" ")}`,
      importance: 4,
    });
  }
  return memories;
}

export function selectLayoutGuides(text: string): string[] {
  const normalized = text.toLowerCase();
  const selected = new Set<string>();
  if (/\b(house|hut|home|shelter)\b/.test(normalized)) selected.add("build_house");
  if (/\b(village|settlement)\b/.test(normalized)) selected.add("build_village");
  if (/\b(base|camp|fort)\b/.test(normalized)) selected.add("build_base");
  if (/\b(farm|crop|wheat|food)\b/.test(normalized)) selected.add("build_farm");
  if (/\b(mine|mining|ore|cobble|stone)\b/.test(normalized)) selected.add("build_mine");
  if (/\b(tool|tools|craft|pickaxe|axe|shovel)\b/.test(normalized)) selected.add("craft_tools");
  if (/\b(find|hunt|kill|attack|player)\b/.test(normalized)) selected.add("find_player");
  return [...selected].map((key) => LAYOUT_INSTRUCTION_GUIDES[key]).filter(Boolean);
}

function selectRecipeKeys(
  input: {
    goal?: string;
    task?: string;
    role?: string;
    inventoryItemNames?: string[];
  },
  dictionary: CraftingRecipeDictionary,
): string[] {
  const text = `${input.goal ?? ""} ${input.task ?? ""} ${input.role ?? ""}`;
  const keys = new Set<string>();
  for (const key of COMMON_RECIPE_KEYS) {
    if (dictionary[key]) keys.add(key);
  }
  for (const hint of KEYWORD_RECIPE_HINTS) {
    if (hint.pattern.test(text)) {
      for (const key of hint.keys) {
        if (dictionary[key]) keys.add(key);
      }
    }
  }
  for (const itemName of input.inventoryItemNames ?? []) {
    const normalized = normalizeItemName(itemName);
    if (normalized.includes("log")) {
      for (const key of ["oak_planks", "crafting_table", "stick"]) {
        if (dictionary[key]) keys.add(key);
      }
    }
    if (normalized.includes("cobblestone") || normalized.includes("cobbled_deepslate")) {
      for (const key of ["stone_pickaxe", "stone_axe", "furnace"]) {
        if (dictionary[key]) keys.add(key);
      }
    }
  }
  return [...keys];
}

function summarizeRecipe(
  data: MinecraftData,
  outputName: string,
  recipe: MinecraftRecipe,
): CraftingRecipeSummary | undefined {
  const ingredientIds = recipe.ingredients ?? recipe.inShape?.flat().filter((id): id is number => typeof id === "number") ?? [];
  if (ingredientIds.length === 0) {
    return undefined;
  }
  return {
    output: outputName,
    outputCount: recipe.result?.count ?? 1,
    ingredients: ingredientList(data, ingredientIds),
  };
}

function ingredientList(data: MinecraftData, ids: number[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const name = data.items[id]?.name ?? data.blocks[id]?.name ?? `id_${id}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => `${count} ${name}`);
}

function dedupeRecipes(recipes: CraftingRecipeSummary[]): CraftingRecipeSummary[] {
  const seen = new Set<string>();
  const unique: CraftingRecipeSummary[] = [];
  for (const recipe of recipes) {
    const key = recipe.ingredients.join("|");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(recipe);
    }
  }
  return unique;
}

function formatRecipeKnowledge(
  key: string,
  recipes: CraftingRecipeSummary[] | undefined,
): string | undefined {
  const recipe = recipes?.[0];
  if (!recipe) {
    return undefined;
  }
  return `${key}=makes ${recipe.outputCount} from ${recipe.ingredients.join(" + ")}`;
}

function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
