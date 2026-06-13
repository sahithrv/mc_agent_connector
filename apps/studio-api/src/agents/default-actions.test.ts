import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAgentActions,
  defaultAgentActionsForRole,
  normalizeConfiguredAgentActions,
} from "./default-actions";

test("normalizeConfiguredAgentActions keeps only configured unique actions", () => {
  assert.deepEqual(
    normalizeConfiguredAgentActions([" move_to ", "chat_ai_private", "move_to"]),
    ["move_to", "chat_ai_private"],
  );
});

test("defaultAgentActions returns a defensive copy of the default action set", () => {
  const actions = defaultAgentActions();
  actions.pop();

  assert.ok(defaultAgentActions().includes("mine_block"));
  assert.ok(defaultAgentActions().includes("chat_public"));
});

test("role action templates are preference subsets rather than full default clones", () => {
  const farmer = defaultAgentActionsForRole("farmer");
  const guard = defaultAgentActionsForRole("guard captain");

  assert.ok(farmer.includes("harvest_crop"));
  assert.ok(farmer.includes("plant_crop"));
  assert.equal(farmer.includes("mine_block"), false);
  assert.ok(guard.includes("attack_entity"));
  assert.equal(guard.includes("harvest_crop"), false);
});
