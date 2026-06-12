import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCraftingRecipeDictionary,
  recipeKnowledgeMemories,
  selectLayoutGuides,
} from "./knowledge";

test("crafting recipe dictionary exposes many real Minecraft recipes", () => {
  const dictionary = buildCraftingRecipeDictionary("1.21.1");

  assert.ok(Object.keys(dictionary).length > 300);
  assert.match(dictionary.crafting_table?.[0]?.ingredients.join(",") ?? "", /planks/);
  assert.match(dictionary.wooden_pickaxe?.[0]?.ingredients.join(",") ?? "", /stick/);
  assert.match(dictionary.furnace?.[0]?.ingredients.join(",") ?? "", /cobbled|cobblestone/);
});

test("recipe knowledge memories include relevant recipes and layout guidance", () => {
  const memories = recipeKnowledgeMemories({
    goal: "follow the leader and build a village with houses",
    task: "craft tools before mining",
    role: "miner",
    inventoryItemNames: ["oak_log", "cobbled_deepslate"],
    version: "1.21.1",
  });

  const summary = memories.map((memory) => memory.summary).join("\n");
  assert.match(summary, /crafting_table/);
  assert.match(summary, /stone_pickaxe/);
  assert.match(summary, /Creative build guidance/);
  assert.match(summary, /village center/);
});

test("layout guide selection maps broad instructions to practical guidance", () => {
  const guides = selectLayoutGuides("build a house and farm near the base");
  const text = guides.join(" ");

  assert.match(text, /shelter/);
  assert.match(text, /defensible/);
  assert.match(text, /Flatten/);
});
