import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { fakeBot } from "../actions/test-helpers";
import type { BotHandle } from "../bots/types";
import type { PerceptionSnapshot as RoutinePerceptionSnapshot } from "../routines";
import { buildAffordances } from "./affordances";

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

test("visible stone produces mine_block affordance", () => {
  const stonePosition = { x: 2, y: 64, z: 1 };
  const affordances = buildAffordances({
    agent: testAgent(),
    bot: capableBot({
      blockAt: () => ({ name: "stone", position: stonePosition, diggable: true }),
      canDigBlock: () => true,
    }),
    perception: testPerception({
      visibleBlocks: [{
        id: "stone-1",
        type: "stone",
        position: stonePosition,
        safe: true,
      }],
    }),
    goal: "gather stone for a village base",
  });

  const mineStone = affordances.find((affordance) =>
    affordance.action === "mine_block" && affordance.params.block === "stone",
  );
  assert.ok(mineStone);
  assert.equal(mineStone.blocked, undefined);
  assert.deepEqual(mineStone.params.position, stonePosition);
  assert.equal(mineStone.advancesGoal, true);
});

test("inventory logs produce planks, sticks, crafting table, and tool craft affordances", () => {
  const affordances = buildAffordances({
    agent: testAgent(),
    bot: capableBot({
      inventory: {
        items: () => [{ name: "oak_log", count: 2 }],
        emptySlotCount: () => 4,
      },
    }),
    perception: testPerception(),
    goal: "craft tools for mining",
  });

  const craftItems = affordances
    .filter((affordance) => affordance.action === "craft_item")
    .map((affordance) => [affordance.params.item, affordance] as const);
  const byItem = new Map(craftItems);

  assert.equal(byItem.get("oak_planks")?.blocked, undefined);
  assert.ok(byItem.get("stick"));
  assert.ok(byItem.get("crafting_table"));
  assert.ok(byItem.get("wooden_pickaxe"));
  assert.match(byItem.get("stick")?.blockedReason ?? "", /planks/);
  assert.match(byItem.get("wooden_pickaxe")?.blockedReason ?? "", /planks|sticks/);
});

test("missing tool for ore produces blocked mine and craft-precondition guidance", () => {
  const orePosition = { x: 3, y: 63, z: 0 };
  const affordances = buildAffordances({
    agent: testAgent(),
    bot: capableBot({
      inventory: {
        items: () => [],
        emptySlotCount: () => 4,
      },
      blockAt: () => ({ name: "iron_ore", position: orePosition, diggable: true }),
      canDigBlock: () => false,
    }),
    perception: testPerception({
      visibleBlocks: [{
        id: "iron-1",
        type: "iron_ore",
        position: orePosition,
        safe: true,
      }],
    }),
    goal: "mine iron ore for tools",
  });

  const blockedMine = affordances.find((affordance) =>
    affordance.action === "mine_block" && affordance.params.block === "iron_ore",
  );
  assert.equal(blockedMine?.blocked, true);
  assert.equal(blockedMine?.blockedReason, "missing stone_pickaxe");

  const stonePickaxe = affordances.find((affordance) =>
    affordance.action === "craft_item" && affordance.params.item === "stone_pickaxe",
  );
  assert.equal(stonePickaxe?.blocked, true);
  assert.match(stonePickaxe?.blockedReason ?? "", /cobblestone/);
  assert.match(stonePickaxe?.blockedReason ?? "", /sticks/);
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
