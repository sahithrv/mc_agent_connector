import assert from "node:assert/strict";
import test from "node:test";

import type { ActionResult, AgentConfig, AiChatMessage, Position } from "@mc-ai-video/contracts";

import { AgentRegistry } from "../agents/registry";
import { fakeBot } from "../actions/test-helpers";
import type { BotHandle } from "../bots/types";
import { StudioEventBus } from "../events/bus";
import { AgentState, CompetitiveTeamOrchestrator } from "../competitive";
import { createLiveAgentRuntime } from "./runtime";

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

test("live runtime briefs a subteam once when a new subteam task is assigned", async () => {
  const agents = [
    agent("leader-1", "LeaderOne", true),
    agent("builder-2", "BuilderTwo"),
    agent("scout-3", "ScoutThree"),
  ];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const messages: AiChatMessage[] = [];
  eventBus.subscribe("chat.message", (message) => messages.push(message));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "subteam-task",
    type: "set-subteam-task",
    payload: {
      subteamId: "red",
      task: "Build a safe village base and split gathering from construction.",
    },
    timestamp: new Date(0).toISOString(),
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.senderId, "leader-1");
  assert.deepEqual(messages[0]?.recipientIds, ["builder-2", "scout-3"]);
  assert.equal(messages[0]?.visibility, "ai");
  assert.equal(messages[0]?.topic, "subteam-task");
  assert.match(messages[0]?.content ?? "", /Build a safe village base/);

  await live.stop();
});

test("live runtime deduplicates repeated subteam task briefings", async () => {
  const agents = [
    agent("leader-1", "LeaderOne", true),
    agent("builder-2", "BuilderTwo"),
  ];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const messages: AiChatMessage[] = [];
  eventBus.subscribe("chat.message", (message) => messages.push(message));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  for (const [id, task] of [
    ["first", "Build a safe village base"],
    ["duplicate", "  build   a SAFE village base  "],
  ] as const) {
    eventBus.emit("director.command", {
      id,
      type: "set-subteam-task",
      payload: {
        subteamId: "red",
        task,
      },
      timestamp: new Date(0).toISOString(),
    });
  }

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.topic, "subteam-task");

  await live.stop();
});

test("live runtime emits restrained AI-private chat for repeated blocked work", async () => {
  const agents = [
    agent("leader-1", "LeaderOne", true),
    agent("farmer-1", "FarmerOne"),
  ];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const messages: AiChatMessage[] = [];
  eventBus.subscribe("chat.message", (message) => messages.push(message));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  const failed: ActionResult = {
    requestId: "mine-failed",
    agentId: "farmer-1",
    action: "mine_block",
    ok: false,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    error: "missing valid tool for block: stone",
  };
  eventBus.emit("action.result", failed);
  eventBus.emit("action.result", { ...failed, requestId: "mine-failed-again" });

  const blockedMessages = messages.filter((message) => message.topic === "blocked");
  assert.equal(blockedMessages.length, 1);
  assert.equal(blockedMessages[0]?.senderId, "farmer-1");
  assert.deepEqual(blockedMessages[0]?.recipientIds, ["leader-1"]);
  assert.equal(blockedMessages[0]?.visibility, "ai");
  assert.match(blockedMessages[0]?.content ?? "", /missing valid tool/);

  await live.stop();
});

test("live runtime routes competitive village goals through competitive orchestration", async () => {
  const agents = [
    agent("builder-1", "BuilderOne", true),
    agent("builder-2", "BuilderTwo"),
  ];
  const registry = new AgentRegistry(agents);
  registry.attachBot("builder-1", buildBot("BuilderOne", { x: 0, y: 64, z: 0 }));
  registry.attachBot("builder-2", buildBot("BuilderTwo", { x: 3, y: 64, z: 0 }));

  const eventBus = new StudioEventBus();
  const results: ActionResult[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "competitive-task",
    type: "set-subteam-task",
    payload: {
      subteamId: "red",
      task: "Competitive objective: build the specified village, then hunt the human player and land the killing blow.",
    },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.ok(results.some((result) => result.ok && result.action === "place_block"));
  const snapshot = live.competitive.snapshot("red");
  assert.equal(snapshot?.phase, AgentState.BUILD_PHASE);
  assert.ok(snapshot.blueprintState.some((blueprint) => blueprint.status === "in_progress"));

  await live.stop();
});

test("live runtime accepts natural kill-me win-condition wording", async () => {
  const agents = [
    agent("builder-1", "BuilderOne", true),
    agent("builder-2", "BuilderTwo"),
  ];
  const registry = new AgentRegistry(agents);
  registry.attachBot("builder-1", buildBot("BuilderOne", { x: 0, y: 64, z: 0 }));
  registry.attachBot("builder-2", buildBot("BuilderTwo", { x: 3, y: 64, z: 0 }));

  const eventBus = new StudioEventBus();
  const results: ActionResult[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "kill-me-task",
    type: "set-subteam-task",
    payload: {
      subteamId: "red",
      task: "Sahith is the human. Build the village first. Whatever team kills me wins.",
    },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.ok(results.some((result) => result.ok && result.action === "place_block"));
  assert.equal(live.competitive.snapshot("red")?.phase, AgentState.BUILD_PHASE);

  await live.stop();
});

test("live runtime keeps competitive orchestration active on event wakes", async () => {
  const agents = [
    agent("builder-1", "BuilderOne", true),
    agent("builder-2", "BuilderTwo"),
  ];
  const registry = new AgentRegistry(agents);
  registry.attachBot("builder-1", buildBot("BuilderOne", { x: 0, y: 64, z: 0 }));
  registry.attachBot("builder-2", buildBot("BuilderTwo", { x: 3, y: 64, z: 0 }));

  const eventBus = new StudioEventBus();
  const results: ActionResult[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "competitive-task",
    type: "set-subteam-task",
    payload: {
      subteamId: "red",
      task: "Competitive objective: build the specified village, then hunt the human player and land the killing blow.",
    },
    timestamp: new Date(0).toISOString(),
  });
  eventBus.emit("game.event", {
    id: "chat-wake",
    type: "player_chat",
    actorId: "Sahith",
    severity: 2,
    visibility: "public",
    payload: { content: "still here" },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.ok(live.competitive.snapshot("red"));
  assert.ok(results.some((result) => result.ok && result.action === "place_block"));

  await live.stop();
});

test("live runtime falls back when competitive orchestration has no deterministic action", async () => {
  const originalPlanNextAction = CompetitiveTeamOrchestrator.prototype.planNextAction;
  CompetitiveTeamOrchestrator.prototype.planNextAction = function (
    ..._args: Parameters<typeof originalPlanNextAction>
  ) {
    return undefined;
  };

  const agents = [agent("farmer-1", "FarmerOne", true)];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const results: ActionResult[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));
  let live: ReturnType<typeof createLiveAgentRuntime> | undefined;

  try {
    live = createLiveAgentRuntime({
      agents,
      registry,
      eventBus,
      tickMs: 1_000,
      maxConcurrentActions: 1,
      maxPlanningSlots: 1,
      planningCooldownMs: 0,
    });

    eventBus.emit("director.command", {
      id: "competitive-task",
      type: "set-subteam-task",
      payload: {
        subteamId: "red",
        task: "Competitive objective: build the specified village, then hunt the human player and land the killing blow.",
      },
      timestamp: new Date(0).toISOString(),
    });

    await live.scheduler.tick();
    await live.scheduler.waitForIdle();
    await live.scheduler.waitForIdle();

    assert.ok(results.some((result) => result.ok && result.action === "idle"));
    assert.equal(results.some((result) => !result.ok), false);
  } finally {
    CompetitiveTeamOrchestrator.prototype.planNextAction = originalPlanNextAction;
    await live?.stop();
  }
});

test("live runtime ignores casual player chat instead of waking all 20 agents", async () => {
  const agents = Array.from({ length: 20 }, (_, index) =>
    agent(`agent-${index.toString().padStart(2, "0")}`, `Agent${index}`),
  );
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 4,
    planningCooldownMs: 0,
  });

  eventBus.emit("game.event", {
    id: "casual-chat",
    type: "player_chat",
    actorId: "Sahith",
    severity: 1,
    visibility: "public",
    payload: { content: "still here, just watching" },
    timestamp: new Date(0).toISOString(),
  });

  assert.equal(
    agents.some((item) => live.scheduler.stateFor(item.id)?.planningQueued),
    false,
  );

  await live.stop();
});

test("live runtime still wakes agents for command-like player chat", async () => {
  const agents = [
    agent("builder-1", "BuilderOne", true),
    agent("builder-2", "BuilderTwo"),
  ];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 2,
    maxPlanningSlots: 2,
    planningCooldownMs: 0,
  });

  eventBus.emit("game.event", {
    id: "command-chat",
    type: "player_chat",
    actorId: "Sahith",
    severity: 2,
    visibility: "public",
    payload: { content: "bots follow me and build a base" },
    timestamp: new Date(0).toISOString(),
  });

  assert.equal(agents.every((item) => live.scheduler.stateFor(item.id)?.planningQueued), true);

  await live.stop();
});

function agent(id: string, username: string, leader = false): AgentConfig {
  return {
    id,
    name: id,
    account: { username, auth: "offline" },
    role: "builder",
    team: "red",
    subteam: "red",
    leader,
    mode: "routine",
    routine: "builder",
    allowedActions: ALL_ACTIONS,
    providerRef: "mock",
    visibility: "ai",
  };
}

function buildBot(username: string, position: Position): BotHandle {
  return fakeBot({
    username,
    entity: {
      id: username,
      type: "player",
      username,
      position,
    },
    inventory: {
      items: () => [
        "cobblestone",
        "oak_planks",
        "glass",
        "torch",
        "sandstone",
        "spruce_log",
        "spruce_planks",
        "furnace",
        "iron_bars",
        "coal",
        "dirt",
        "wheat_seeds",
        "oak_fence",
        "water_bucket",
        "ladder",
      ].map((name) => ({ name, count: 128 })),
      emptySlotCount: () => 4,
    },
    blockAt(target) {
      if (target.y < position.y) {
        return { name: "grass_block", position: target, diggable: true };
      }
      return { name: "air", position: target, diggable: false };
    },
    pathfinder: {
      async goto() {},
      setGoal() {},
    },
    async equip() {},
    async placeBlock() {},
  });
}
