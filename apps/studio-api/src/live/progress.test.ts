import assert from "node:assert/strict";
import test from "node:test";

import {
  actionProgressDeltaFromResult,
  applyActionProgressDelta,
  createProgressSnapshot,
  emptyActionProgressCounters,
  extractProgressSignal,
} from "./progress";

test("extractProgressSignal detects inventory, position, and vital changes", () => {
  const before = createProgressSnapshot({
    bot: {
      username: "agent",
      health: 20,
      food: 18,
      entity: { id: "agent", position: { x: 1, y: 64, z: 1, world: "world" } },
      inventory: { items: () => [{ name: "oak_log", count: 2 }] },
      on() { return this; },
      chat() {},
      quit() {},
    },
  });
  const after = createProgressSnapshot({
    bot: {
      username: "agent",
      health: 18,
      food: 17,
      entity: { id: "agent", position: { x: 3, y: 64, z: 1, world: "world" } },
      inventory: { items: () => [{ name: "oak_log", count: 1 }, { name: "stick", count: 4 }] },
      on() { return this; },
      chat() {},
      quit() {},
    },
  });

  const signal = extractProgressSignal(before, after);

  assert.equal(signal.changed, true);
  assert.ok(signal.changes.includes("inventory"));
  assert.ok(signal.changes.includes("position"));
  assert.ok(signal.changes.includes("health"));
  assert.ok(signal.changes.includes("food"));
  assert.deepEqual(signal.delta.inventory, { oak_log: -1, stick: 4 });
});

test("extractProgressSignal detects action and team goal counter changes", () => {
  const before = createProgressSnapshot({
    actionCounts: emptyActionProgressCounters(),
    teamGoal: teamGoalProgress({ minedBlocks: 1, placedBlocks: 0 }),
  });
  const after = createProgressSnapshot({
    actionCounts: {
      ...emptyActionProgressCounters(),
      minedBlocks: 1,
      craftedItems: 2,
    },
    teamGoal: teamGoalProgress({ minedBlocks: 2, placedBlocks: 1 }),
  });

  const signal = extractProgressSignal(before, after);

  assert.equal(signal.changed, true);
  assert.ok(signal.changes.includes("minedBlocks"));
  assert.ok(signal.changes.includes("craftedItems"));
  assert.ok(signal.changes.includes("teamGoal.minedBlocks"));
  assert.ok(signal.changes.includes("teamGoal.placedBlocks"));
  assert.equal(signal.delta.minedBlocks, 1);
  assert.equal(signal.delta.craftedItems, 2);
  assert.equal(signal.delta["teamGoal.minedBlocks"], 1);
  assert.equal(signal.delta["teamGoal.placedBlocks"], 1);
});

test("repeated equivalent snapshots report no progress", () => {
  const snapshot = createProgressSnapshot({
    perception: {
      agentId: "farmer-1",
      health: 20,
      inventory: { tools: ["hoe"], seeds: 3, food: 5 },
      visibleBlocks: [],
      nearbyEntities: [],
      nearbyPlayers: [],
    },
    actionCounts: emptyActionProgressCounters(),
  });

  const signal = extractProgressSignal(snapshot, createProgressSnapshot({
    perception: {
      agentId: "farmer-1",
      health: 20,
      inventory: { tools: ["hoe"], seeds: 3, food: 5 },
      visibleBlocks: [],
      nearbyEntities: [],
      nearbyPlayers: [],
    },
    actionCounts: emptyActionProgressCounters(),
  }));

  assert.equal(signal.changed, false);
  assert.deepEqual(signal.changes, []);
});

test("actionProgressDeltaFromResult counts concrete world-producing action results", () => {
  let counters = emptyActionProgressCounters();
  counters = applyActionProgressDelta(counters, actionProgressDeltaFromResult({
    requestId: "mine",
    agentId: "miner-1",
    action: "mine_block",
    ok: true,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    data: { block: "stone", position: { x: 1, y: 64, z: 2 } },
  }));
  counters = applyActionProgressDelta(counters, actionProgressDeltaFromResult({
    requestId: "craft",
    agentId: "miner-1",
    action: "craft_item",
    ok: true,
    startedAt: new Date(2).toISOString(),
    completedAt: new Date(3).toISOString(),
    data: { item: "stick", count: 4 },
  }));

  assert.equal(counters.minedBlocks, 1);
  assert.equal(counters.craftedItems, 4);
  assert.deepEqual(actionProgressDeltaFromResult({
    requestId: "empty",
    agentId: "miner-1",
    action: "mine_block",
    ok: true,
    startedAt: new Date(4).toISOString(),
    completedAt: new Date(5).toISOString(),
  }), {});
});

function teamGoalProgress(progress: Partial<Record<string, number>>) {
  return {
    teamId: "red",
    goalText: "Build a base",
    phase: "build_base" as const,
    claimed: true,
    memberOffsets: {},
    failedMovementTargets: [],
    progress: {
      scoutMoves: 0,
      claimedSites: 0,
      minedBlocks: 0,
      collectedItems: 0,
      placedBlocks: 0,
      patrols: 0,
      hunts: 0,
      movementRetries: 0,
      ...progress,
    },
  };
}
