import assert from "node:assert/strict";
import test from "node:test";

import { targetKeyForAction } from "./action-target-key";

test("targetKeyForAction normalizes nested and direct positions", () => {
  assert.equal(
    targetKeyForAction("mine_block", {
      position: { x: 12, y: 64, z: -9, world: "world" },
      block: "iron_ore",
    }),
    "mine_block:world:12,64,-9",
  );
  assert.equal(
    targetKeyForAction("mine_block", {
      x: 12,
      y: 64,
      z: -9,
      world: "world",
      block: "iron_ore",
    }),
    "mine_block:world:12,64,-9",
  );
});

test("targetKeyForAction creates stable action-specific keys", () => {
  assert.equal(
    targetKeyForAction("place_block", {
      position: { x: 1, y: 65, z: 2, world: "world" },
      block: "Oak Planks",
    }),
    "place_block:world:1,65,2:oak_planks",
  );
  assert.equal(targetKeyForAction("collect_item", { entityId: "drop-1", item: "coal" }), "collect_item:drop-1");
  assert.equal(targetKeyForAction("craft_item", { item: "stone_pickaxe", count: 1 }), "craft_item:stone_pickaxe:1");
  assert.equal(
    targetKeyForAction("move_to", { x: 4, y: 64, z: 8, world: "world", range: 2 }),
    "move_to:world:4,64,8:range=2",
  );
  assert.equal(targetKeyForAction("follow_player", { username: "Alex" }), "follow_player:Alex");
  assert.equal(targetKeyForAction("attack_entity", { username: "Alex" }), "attack_entity:Alex");
});
