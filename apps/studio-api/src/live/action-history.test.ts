import assert from "node:assert/strict";
import test from "node:test";

import type { ActionResult } from "@mc-ai-video/contracts";

import { ActionHistoryStore } from "./action-history";

test("ActionHistoryStore keeps recent results with failure details and metadata", () => {
  const store = new ActionHistoryStore();

  for (let index = 0; index < 22; index += 1) {
    store.record(actionResult(index));
  }

  const recent = store.recentForAgent("miner-1");
  assert.equal(recent.length, 20);
  assert.equal(recent[0]?.requestId, "request-2");

  const latest = recent.at(-1);
  assert.equal(latest?.requestId, "request-21");
  assert.equal(latest?.action, "mine_block");
  assert.equal(latest?.ok, false);
  assert.equal(latest?.error, "missing valid tool for block: iron_ore");
  assert.equal(latest?.params.block, "iron_ore");
  assert.equal(latest?.requestedBy, "llm");
  assert.equal(latest?.source, "fallback");
  assert.equal(latest?.targetKey, "mine_block:unknown:21,64,1");
});

function actionResult(index: number): ActionResult {
  return {
    requestId: `request-${index}`,
    agentId: "miner-1",
    action: "mine_block",
    params: {
      block: "iron_ore",
      position: { x: index, y: 64, z: 1 },
      reason: "gathering ore for tools",
    },
    ok: false,
    startedAt: new Date(index).toISOString(),
    completedAt: new Date(index + 1).toISOString(),
    error: "missing valid tool for block: iron_ore",
    data: { status: "failed_precondition" },
    requestedBy: "llm",
    source: "fallback",
    targetKey: "block:iron_ore",
  };
}
