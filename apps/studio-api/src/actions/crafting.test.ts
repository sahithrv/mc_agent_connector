import assert from "node:assert/strict";
import test from "node:test";

import type { BotBlock } from "../bots/types";
import { createDefaultActionRegistry } from "./index";
import { actionRequest, fakeAgent, fakeBot } from "./test-helpers";

test("craft_item crafts a known item with a nearby crafting table", async () => {
  const table: BotBlock = {
    name: "crafting_table",
    position: { x: 1, y: 64, z: 0 },
  };
  const calls: unknown[] = [];
  const result = await createDefaultActionRegistry().run(
    actionRequest("craft_item", { item: "wood pickaxe", count: 2 }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        version: "1.21.1",
        findBlock(options) {
          assert.equal(options.matching, 182);
          return table;
        },
        recipesFor(itemType, metadata, minResultCount, craftingTable) {
          calls.push({ itemType, metadata, minResultCount, craftingTable });
          return [{ id: "wooden-pickaxe-recipe" }];
        },
        async craft(recipe, count, craftingTable) {
          calls.push({ recipe, count, craftingTable });
        },
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.item, "wooden_pickaxe");
  assert.equal(result.data?.count, 2);
  assert.equal(result.data?.usedCraftingTable, true);
  assert.equal(calls.length, 2);
});

test("craft_item fails clearly when no recipe is craftable", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("craft_item", { item: "stone_pickaxe" }),
    {
      agent: fakeAgent(),
      bot: fakeBot({
        version: "1.21.1",
        recipesFor() {
          return [];
        },
        async craft() {
          throw new Error("craft should not be called");
        },
      }),
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no craftable recipe/);
});
