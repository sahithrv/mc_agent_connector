import assert from "node:assert/strict";
import test from "node:test";

import type { ActionResult, AgentConfig, JsonValue } from "@mc-ai-video/contracts";

import { createDefaultSkillRegistry } from "./registry";

const ALL_ACTIONS = [
  "idle",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "harvest_crop",
  "plant_crop",
  "craft_item",
  "place_block",
  "attack_entity",
  "chat_public",
  "chat_ai_private",
];

test("skill registry expands gather_wood into primitive actions and completes from per-agent state", () => {
  const registry = createDefaultSkillRegistry();
  const request = registry.request({
    agentId: "miner-1",
    skill: "gather_wood",
    params: { count: 1 },
    goal: "collect wood for tools",
  });

  const first = registry.planNext({
    agent: agent("miner-1"),
    perception: perceptionWithBlock("oak_log"),
    request,
    currentPosition: { x: 0, y: 64, z: 0 },
  });

  assert.equal(first.action?.action, "mine_block");
  assert.equal(first.action?.requestedBy, "skill:gather_wood");
  assert.equal(first.action?.source, "skill");
  assert.equal(registry.hasActive("miner-1"), true);

  registry.recordActionResult(actionResult(first.action, {
    agentId: "miner-1",
    action: "mine_block",
    data: { block: "oak_log" },
  }));

  const next = registry.planActive({
    agent: agent("miner-1"),
    perception: perceptionWithBlock("oak_log"),
    currentPosition: { x: 0, y: 64, z: 0 },
  });

  assert.equal(next?.done, true);
  assert.equal(registry.hasActive("miner-1"), false);
});

test("skill registry can continue follow_leader across action result ticks", () => {
  const registry = createDefaultSkillRegistry();
  const request = registry.request({
    agentId: "builder-1",
    skill: "follow_leader",
    params: { steps: 2 },
  });

  const first = registry.planNext({
    agent: agent("builder-1"),
    perception: emptyPerception("builder-1"),
    request,
    leaderUsername: "LeaderOne",
  });
  assert.equal(first.action?.action, "follow_player");
  assert.equal(first.action?.params.username, "LeaderOne");

  registry.recordActionResult(actionResult(first.action, {
    agentId: "builder-1",
    action: "follow_player",
  }));

  const second = registry.planActive({
    agent: agent("builder-1"),
    perception: emptyPerception("builder-1"),
    leaderUsername: "LeaderOne",
  });
  assert.equal(second?.action?.action, "follow_player");

  registry.recordActionResult(actionResult(second?.action, {
    agentId: "builder-1",
    action: "follow_player",
  }));

  const done = registry.planActive({
    agent: agent("builder-1"),
    perception: emptyPerception("builder-1"),
    leaderUsername: "LeaderOne",
  });
  assert.equal(done?.done, true);
});

function agent(id: string): AgentConfig {
  return {
    id,
    name: id,
    account: { username: id, auth: "offline" },
    role: "builder",
    team: "red",
    subteam: "red",
    mode: "routine",
    routine: "builder",
    allowedActions: ALL_ACTIONS,
    providerRef: "mock",
    visibility: "ai",
  };
}

function emptyPerception(agentId: string) {
  return {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
    patrolPoints: [{ x: 0, y: 64, z: 0 }],
  };
}

function perceptionWithBlock(type: string) {
  return {
    ...emptyPerception("miner-1"),
    visibleBlocks: [{
      id: "block-1",
      type,
      position: { x: 1, y: 64, z: 0 },
      safe: true,
    }],
  };
}

function actionResult(
  action: { params: Record<string, JsonValue>; requestedBy?: string; source?: string } | undefined,
  input: Pick<ActionResult, "agentId" | "action"> & Partial<ActionResult>,
): ActionResult {
  assert.ok(action);
  return {
    requestId: input.requestId ?? "request-1",
    agentId: input.agentId,
    action: input.action,
    ok: input.ok ?? true,
    startedAt: input.startedAt ?? new Date(0).toISOString(),
    completedAt: input.completedAt ?? new Date(1).toISOString(),
    params: action.params,
    requestedBy: action.requestedBy,
    source: action.source,
    data: input.data,
    error: input.error,
  };
}
