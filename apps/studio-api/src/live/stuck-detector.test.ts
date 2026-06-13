import assert from "node:assert/strict";
import test from "node:test";

import type { JsonValue } from "@mc-ai-video/contracts";

import type { ActionHistoryEntry } from "./action-history";
import { analyzeStuck } from "./stuck-detector";

const NOW = Date.parse("2026-06-13T12:00:00.000Z");

test("analyzeStuck blocks repeated failed mining target", () => {
  const history = [
    entry({
      action: "mine_block",
      ok: false,
      params: { position: { x: 1, y: 64, z: 2, world: "world" }, block: "iron_ore" },
      error: "missing stone_pickaxe",
      completedAtMs: NOW - 20_000,
    }),
    entry({
      action: "mine_block",
      ok: false,
      params: { x: 1, y: 64, z: 2, world: "world", block: "iron_ore" },
      error: "missing stone_pickaxe",
      completedAtMs: NOW - 5_000,
    }),
  ];

  const analysis = analyzeStuck("miner-1", history, {
    activeGoal: "mine iron ore",
    now: NOW,
  });

  assert.equal(analysis.stuck, true);
  assert.deepEqual(analysis.blockedTargetKeys, ["mine_block:world:1,64,2"]);
  assert.match(analysis.recoveryPromptHint ?? "", /Avoid retrying mine_block:world:1,64,2/);
});

test("analyzeStuck detects repeated idle while active goal exists", () => {
  const history = [
    entry({ action: "idle", ok: true, completedAtMs: NOW - 3_000 }),
    entry({ action: "idle", ok: true, completedAtMs: NOW - 2_000 }),
    entry({ action: "idle", ok: true, completedAtMs: NOW - 1_000 }),
  ];

  const analysis = analyzeStuck("miner-1", history, {
    activeGoal: "build a village base",
    now: NOW,
  });

  assert.equal(analysis.stuck, true);
  assert.match(analysis.reason ?? "", /three consecutive idle/);
});

test("analyzeStuck detects repeated move_to success without reaching target", () => {
  const target = { x: 20, y: 64, z: 0, world: "world" };
  const history = [
    entry({ action: "move_to", ok: true, params: { position: target, range: 2 }, completedAtMs: NOW - 6_000 }),
    entry({ action: "move_to", ok: true, params: { x: 20, y: 64, z: 0, world: "world", range: 2 }, completedAtMs: NOW - 3_000 }),
    entry({ action: "move_to", ok: true, params: { position: target, range: 2 }, completedAtMs: NOW - 1_000 }),
  ];

  const analysis = analyzeStuck("miner-1", history, {
    activeGoal: "move to the scout point",
    position: { x: 0, y: 64, z: 0, world: "world" },
    now: NOW,
  });

  assert.equal(analysis.stuck, true);
  assert.deepEqual(analysis.blockedTargetKeys, ["move_to:world:20,64,0:range=2"]);
  assert.match(analysis.reason ?? "", /move_to reported success/);
});

test("analyzeStuck detects repeated successful targets with no progress signal change", () => {
  const history = [
    entry({
      action: "mine_block",
      ok: true,
      params: { block: "stone", position: { x: 1, y: 64, z: 2, world: "world" } },
      data: unchangedProgress("same-world-state"),
      completedAtMs: NOW - 3_000,
    }),
    entry({
      action: "mine_block",
      ok: true,
      params: { block: "stone", position: { x: 1, y: 64, z: 2, world: "world" } },
      data: unchangedProgress("same-world-state"),
      completedAtMs: NOW - 2_000,
    }),
    entry({
      action: "mine_block",
      ok: true,
      params: { block: "stone", position: { x: 1, y: 64, z: 2, world: "world" } },
      data: unchangedProgress("same-world-state"),
      completedAtMs: NOW - 1_000,
    }),
  ];

  const analysis = analyzeStuck("miner-1", history, {
    activeGoal: "mine stone for the base",
    now: NOW,
  });

  assert.equal(analysis.stuck, true);
  assert.match(analysis.reason ?? "", /without measurable progress/);
  assert.deepEqual(analysis.blockedTargetKeys, ["mine_block:world:1,64,2"]);
});

function entry(input: {
  action: string;
  ok: boolean;
  params?: Record<string, JsonValue>;
  data?: Record<string, JsonValue>;
  error?: string;
  completedAtMs: number;
}): ActionHistoryEntry {
  return {
    requestId: `request-${input.completedAtMs}`,
    agentId: "miner-1",
    action: input.action,
    params: input.params ?? {},
    ok: input.ok,
    error: input.error,
    data: input.data,
    startedAt: new Date(input.completedAtMs - 100).toISOString(),
    completedAt: new Date(input.completedAtMs).toISOString(),
  };
}

function unchangedProgress(signature: string): Record<string, JsonValue> {
  return {
    progressSignal: {
      changed: false,
      baseline: true,
      changes: [],
      delta: {},
      beforeSignature: signature,
      afterSignature: signature,
    },
    progressSignature: signature,
  };
}
