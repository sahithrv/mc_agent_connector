import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig, Position } from "@mc-ai-video/contracts";

import { fakeBot } from "../actions/test-helpers";
import type { BotHandle } from "../bots/types";
import type { PerceptionSnapshot as RoutinePerceptionSnapshot, RoutineActionIntent } from "../routines";
import { targetKeyForAction } from "./action-target-key";
import type { ActionAffordance } from "./affordances";
import { validateIntentFeasibility } from "./action-feasibility";

const ALL_ACTIONS = [
  "idle",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "craft_item",
  "place_block",
  "attack_entity",
  "chat_public",
  "chat_ai_private",
];

test("validateIntentFeasibility rejects stuck blocked targets and returns goal alternatives", () => {
  const blockedPosition = { x: 1, y: 64, z: 1 };
  const alternativePosition = { x: 2, y: 64, z: 1 };
  const blockedKey = targetKeyForAction("mine_block", { position: blockedPosition, block: "stone" });
  const result = validateIntentFeasibility({
    agent: testAgent(),
    perception: testPerception(),
    intent: intent("mine_block", { position: blockedPosition, block: "stone" }),
    affordances: [{
      action: "mine_block",
      params: { position: alternativePosition, block: "stone" },
      score: 0.9,
      reason: "visible alternate stone",
      advancesGoal: true,
      targetKey: targetKeyForAction("mine_block", { position: alternativePosition, block: "stone" }),
    }],
    blockedTargetKeys: [blockedKey],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /blocked/);
    assert.equal(result.alternatives[0]?.action, "mine_block");
    assert.deepEqual(result.alternatives[0]?.params.position, alternativePosition);
  }
});

test("validateIntentFeasibility rejects visible mine target without a valid tool", () => {
  const position = { x: 3, y: 63, z: 0 };
  const result = validateIntentFeasibility({
    agent: testAgent(),
    bot: capableBot({
      blockAt: () => ({ name: "iron_ore", position, diggable: true }),
      canDigBlock: () => false,
    }),
    perception: testPerception({
      visibleBlocks: [{
        id: "iron-ore",
        type: "iron_ore",
        position,
        safe: true,
      }],
    }),
    intent: intent("mine_block", { position, block: "iron_ore" }),
    affordances: [],
    blockedTargetKeys: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /missing valid tool|stone_pickaxe/);
  }
});

test("validateIntentFeasibility rejects non-craftable item and suggests craft precondition", () => {
  const result = validateIntentFeasibility({
    agent: testAgent(),
    bot: capableBot({
      async craft() {},
      recipesFor: () => [],
    }),
    perception: testPerception(),
    intent: intent("craft_item", { item: "wooden_pickaxe", count: 1 }),
    affordances: [{
      action: "craft_item",
      params: { item: "wooden_pickaxe", count: 1 },
      score: 0.82,
      reason: "wooden pickaxe enables stone mining",
      advancesGoal: true,
      blocked: true,
      blockedReason: "need planks/sticks",
      targetKey: targetKeyForAction("craft_item", { item: "wooden_pickaxe", count: 1 }),
    }, {
      action: "craft_item",
      params: { item: "oak_planks", count: 4 },
      score: 0.95,
      reason: "logs in inventory; needed for tools",
      advancesGoal: true,
      targetKey: targetKeyForAction("craft_item", { item: "oak_planks", count: 4 }),
    }],
    blockedTargetKeys: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /unmet precondition/);
    assert.equal(result.alternatives[0]?.action, "craft_item");
    assert.equal(result.alternatives[0]?.params.item, "oak_planks");
  }
});

test("validateIntentFeasibility rejects place_block without adjacent reference block", () => {
  const target = { x: 1, y: 64, z: 0 };
  const result = validateIntentFeasibility({
    agent: testAgent(),
    bot: capableBot({
      inventory: {
        items: () => [{ name: "cobblestone", count: 8 }],
        emptySlotCount: () => 4,
      },
      blockAt: () => ({ name: "air", position: target, diggable: false }),
      async equip() {},
      async placeBlock() {},
    }),
    perception: testPerception(),
    intent: intent("place_block", { position: target, block: "cobblestone" }),
    affordances: [],
    blockedTargetKeys: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /reference block/);
  }
});

test("validateIntentFeasibility rejects follow_player when target is not visible", () => {
  const result = validateIntentFeasibility({
    agent: testAgent(),
    bot: capableBot(),
    perception: testPerception(),
    intent: intent("follow_player", { username: "MissingPlayer" }),
    affordances: [],
    blockedTargetKeys: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /not visible/);
  }
});

function testAgent(): AgentConfig {
  return {
    id: "agent-a",
    name: "Ada",
    account: {
      username: "AdaBot",
      auth: "offline",
    },
    role: "miner",
    team: "blue",
    mode: "routine",
    routine: "miner",
    allowedActions: ALL_ACTIONS,
    providerRef: "mock",
  };
}

function capableBot(overrides: Partial<BotHandle> = {}): BotHandle {
  return fakeBot({
    entity: {
      id: "self",
      type: "player",
      username: "AdaBot",
      position: { x: 0, y: 64, z: 0 },
    },
    pathfinder: {
      async goto() {},
    },
    collectBlock: {
      async collect() {},
    },
    async dig() {},
    async craft() {},
    recipesFor: () => [{}],
    async equip() {},
    async placeBlock() {},
    attack() {},
    ...overrides,
  });
}

function testPerception(
  overrides: Partial<RoutinePerceptionSnapshot> = {},
): RoutinePerceptionSnapshot {
  return {
    agentId: "agent-a",
    health: 20,
    inventory: {
      tools: [],
      seeds: 0,
    },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
    patrolPoints: [{ x: 8, y: 64, z: 0 }],
    ...overrides,
  };
}

function intent(action: string, params: RoutineActionIntent["params"]): RoutineActionIntent {
  return {
    action,
    params,
    timeoutMs: 10_000,
    requestedBy: "llm",
  };
}
