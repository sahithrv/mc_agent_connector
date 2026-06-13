import assert from "node:assert/strict";
import test from "node:test";

import { AgentTaskStateStore, type PlanStep } from "./task-state";

test("agent task state resets on new goals and advances plan steps from action results", () => {
  const store = new AgentTaskStateStore();
  assert.equal(store.setGoal("miner-1", "Gather stone for the base"), true);
  assert.equal(store.setGoal("miner-1", "Gather stone for the base"), false);

  const steps: PlanStep[] = [
    {
      id: "mine-stone",
      description: "Mine visible stone",
      status: "active",
      successCondition: "stone is mined",
      nextAction: "mine_block",
    },
    {
      id: "craft-tool",
      description: "Craft a better pickaxe",
      status: "pending",
      neededItems: { cobblestone: 3 },
      successCondition: "pickaxe is crafted",
      nextAction: "craft_item",
    },
    {
      id: "report",
      description: "Report progress to the subteam",
      status: "pending",
      successCondition: "leader has the update",
      nextAction: "chat_ai_private",
    },
  ];
  store.setPlan({ agentId: "miner-1", goal: "Gather stone for the base", steps });

  let state = store.recordActionResult({
    requestId: "mine-ok",
    agentId: "miner-1",
    action: "mine_block",
    ok: true,
    params: { block: "stone", position: { x: 1, y: 64, z: 2 } },
    startedAt: "2026-06-13T00:00:00.000Z",
    completedAt: "2026-06-13T00:00:01.000Z",
  });

  assert.equal(state?.plan[0]?.status, "done");
  assert.equal(state?.plan[1]?.status, "active");
  assert.equal(state?.currentStepId, "craft-tool");

  const failedCraft = {
    requestId: "craft-failed",
    agentId: "miner-1",
    action: "craft_item",
    ok: false,
    params: { item: "stone_pickaxe" },
    startedAt: "2026-06-13T00:00:02.000Z",
    completedAt: "2026-06-13T00:00:03.000Z",
    error: "need cobblestone",
  };
  state = store.recordActionResult(failedCraft);
  assert.equal(state?.plan[1]?.status, "blocked");
  assert.equal(state?.plan[1]?.blocker, "need cobblestone");
  assert.equal(store.currentStepBlockedRepeatedly("miner-1"), false);

  store.recordActionResult({ ...failedCraft, requestId: "craft-failed-again" });
  assert.equal(store.currentStepBlockedRepeatedly("miner-1"), true);
  assert.equal(store.pendingPlanReason("miner-1"), "blocked_repeatedly");

  assert.equal(store.setGoal("miner-1", "Build a small shelter"), true);
  state = store.stateFor("miner-1");
  assert.equal(state.goal, "Build a small shelter");
  assert.equal(state.plan.length, 0);
  assert.equal(store.pendingPlanReason("miner-1"), "new_goal");
});

test("agent task state exposes a compact prompt plan", () => {
  const store = new AgentTaskStateStore();
  store.setGoal("builder-1", "Build a shelter");
  store.setPlan({
    agentId: "builder-1",
    goal: "Build a shelter",
    steps: [
      {
        id: "collect-wood",
        description: "Collect wood near the build site",
        status: "done",
        successCondition: "wood is available",
        nextAction: "collect_item",
      },
      {
        id: "place-walls",
        description: "Place wall blocks at the shelter site",
        status: "active",
        successCondition: "first wall blocks are placed",
        nextAction: "place_block",
      },
      {
        id: "roof",
        description: "Add a simple roof",
        status: "pending",
        successCondition: "roof blocks are placed",
        nextAction: "place_block",
      },
    ],
  });

  const prompt = store.toPromptState("builder-1");
  assert.equal(prompt?.goal, "Build a shelter");
  assert.equal(prompt?.currentStepId, "place-walls");
  assert.equal(prompt?.plan[0]?.id, "place-walls");
  assert.equal(prompt?.plan.some((step) => step.id === "collect-wood"), true);
});

test("agent task state does not complete progress-sensitive steps with no progress signal", () => {
  const store = new AgentTaskStateStore();
  store.setPlan({
    agentId: "miner-1",
    goal: "Gather stone for the base",
    steps: [
      {
        id: "mine-stone",
        description: "Mine visible stone",
        status: "active",
        successCondition: "stone is mined",
        nextAction: "mine_block",
      },
      {
        id: "report",
        description: "Report progress",
        status: "pending",
        nextAction: "chat_ai_private",
      },
    ],
  });

  const noProgressResult = {
    requestId: "mine-no-progress",
    agentId: "miner-1",
    action: "mine_block",
    ok: true,
    params: { block: "stone" },
    startedAt: "2026-06-13T00:00:00.000Z",
    completedAt: "2026-06-13T00:00:01.000Z",
    data: unchangedProgress("same-state"),
  };

  let state = store.recordActionResult(noProgressResult);
  assert.equal(state?.plan[0]?.status, "blocked");
  assert.match(state?.plan[0]?.blocker ?? "", /no measurable progress/);
  assert.equal(state?.currentStepId, "mine-stone");
  assert.equal(state?.plan[1]?.status, "pending");

  state = store.recordActionResult({ ...noProgressResult, requestId: "mine-no-progress-again" });
  assert.equal(state?.plan[0]?.status, "blocked");
  assert.equal(store.pendingPlanReason("miner-1"), "blocked_repeatedly");
});

function unchangedProgress(signature: string) {
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
