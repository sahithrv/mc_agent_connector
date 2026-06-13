import assert from "node:assert/strict";
import test from "node:test";

import type { ActionResult, AgentConfig, AiChatMessage, GameEvent, Position } from "@mc-ai-video/contracts";

import { AgentRegistry } from "../agents/registry";
import { fakeBot } from "../actions/test-helpers";
import type { BotHandle } from "../bots/types";
import { StudioEventBus } from "../events/bus";
import { AgentState, CompetitiveTeamOrchestrator } from "../competitive";
import { LlmProviderRegistry } from "../llm/providers";
import type { LlmRequest } from "../llm/providers/types";
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
  const traces: GameEvent[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));
  eventBus.subscribe("game.event", (event) => {
    if (event.type === "decision.trace") traces.push(event);
  });

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
  const competitiveTrace = traces.find((event) =>
    event.payload.source === "competitive" && event.payload.action === "place_block",
  );
  assert.equal(competitiveTrace?.visibility, "ai");
  assert.equal(competitiveTrace?.payload.fallback, false);
  assert.match(String(competitiveTrace?.payload.reason ?? ""), /competitive/);
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

test("live runtime records action result history from the action.result subscription", async () => {
  const agents = [agent("miner-1", "MinerOne", true)];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    tickMs: 1_000,
    maxConcurrentActions: 1,
    maxPlanningSlots: 1,
    planningCooldownMs: 0,
  });

  eventBus.emit("action.result", {
    requestId: "mine-iron-failed",
    agentId: "miner-1",
    action: "mine_block",
    params: {
      block: "iron_ore",
      position: { x: 8, y: 63, z: -2 },
      reason: "gathering iron for tools",
    },
    ok: false,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    error: "missing valid tool for block: iron_ore",
    data: { status: "failed_precondition" },
    requestedBy: "llm",
    source: "llm",
  });

  const history = live.actionHistory.recentForAgent("miner-1");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.error, "missing valid tool for block: iron_ore");
  assert.equal(history[0]?.params.block, "iron_ore");
  assert.equal(history[0]?.targetKey, "mine_block:unknown:8,63,-2");
  assert.equal(history[0]?.requestedBy, "llm");
  assert.equal(history[0]?.source, "llm");

  await live.stop();
});

test("live runtime generates a task plan once and reuses it on later planning ticks", async () => {
  const agents = [agent("planner-1", "PlannerOne", true)];
  const registry = new AgentRegistry(agents);
  const eventBus = new StudioEventBus();
  const providers = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  providers.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      if (request.schemaName === "AgentTaskPlan") {
        return {
          ok: true,
          value: schema.parse({
            goal: "Build a starter shelter",
            currentStepId: "collect-materials",
            steps: [
              {
                id: "collect-materials",
                description: "Collect visible shelter materials",
                status: "active",
                successCondition: "usable blocks are available",
                nextAction: "chat_ai_private",
              },
              {
                id: "place-walls",
                description: "Place first shelter wall blocks",
                status: "pending",
                successCondition: "wall blocks are placed",
                nextAction: "chat_ai_private",
              },
              {
                id: "report",
                description: "Report the result or blocker",
                status: "pending",
                successCondition: "leader receives a concrete update",
                nextAction: "chat_ai_private",
              },
            ],
            reasoningSummary: "Start with materials, then build, then report blockers.",
          }),
        };
      }
      return {
        ok: true,
        value: schema.parse({
          intent: "wait for executable context",
          action: "idle",
          parameters: { durationMs: 1 },
          confidence: 0.55,
          reasoningSummary: "No bot perception is available in this test.",
        }),
      };
    },
  });

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    providers,
    tickMs: 1_000,
    maxConcurrentActions: 1,
    maxPlanningSlots: 1,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "agent-task",
    type: "set-agent-task",
    targetAgentId: "planner-1",
    payload: { task: "Build a starter shelter" },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.equal(requests.filter((request) => request.schemaName === "AgentTaskPlan").length, 1);
  assert.equal(live.taskState.stateFor("planner-1").plan.length, 3);
  assert.match(
    requests.find((request) => request.schemaName === "AgentDecision")?.messages[0]?.content ?? "",
    /CURRENT_PLAN/,
  );

  live.scheduler.queuePlanning("planner-1", { type: "manual" });
  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.equal(requests.filter((request) => request.schemaName === "AgentTaskPlan").length, 1);
  assert.equal(live.taskState.stateFor("planner-1").plan.length, 3);

  const failedAction = {
    requestId: "blocked-chat",
    agentId: "planner-1",
    action: "chat_ai_private",
    ok: false,
    params: { message: "blocked" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: "no reachable teammate channel",
    requestedBy: "llm",
    source: "llm",
  };
  eventBus.emit("action.result", failedAction);
  eventBus.emit("action.result", { ...failedAction, requestId: "blocked-chat-again" });
  live.scheduler.queuePlanning("planner-1", { type: "manual" });
  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.equal(requests.filter((request) => request.schemaName === "AgentTaskPlan").length, 2);

  await live.stop();
});

test("live runtime uses goal-advancing affordance instead of infeasible LLM action", async () => {
  const agents = [agent("miner-1", "MinerOne", true)];
  const registry = new AgentRegistry(agents);
  const visibleStone = { x: 2, y: 64, z: 0 };
  const dug: Position[] = [];
  registry.attachBot("miner-1", miningBot("MinerOne", {
    stonePosition: visibleStone,
    onDig(position) {
      dug.push(position);
    },
  }));

  const eventBus = new StudioEventBus();
  const providers = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  providers.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      if (request.schemaName === "AgentTaskPlan") {
        return { ok: true, value: schema.parse(planOutput("Need stone soon", "mine_block")) };
      }
      return {
        ok: true,
        value: schema.parse({
          intent: "mine invented stone target",
          action: "mine_block",
          parameters: { position: { x: 40, y: 64, z: 0 }, block: "stone" },
          confidence: 0.7,
          reasoningSummary: "Trying a distant stone target.",
        }),
      };
    },
  });
  const traces: GameEvent[] = [];
  const results: ActionResult[] = [];
  eventBus.subscribe("game.event", (event) => {
    if (event.type === "decision.trace") traces.push(event);
  });
  eventBus.subscribe("action.result", (result) => results.push(result));

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    providers,
    tickMs: 1_000,
    maxConcurrentActions: 1,
    maxPlanningSlots: 1,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "stone-task",
    type: "set-agent-task",
    targetAgentId: "miner-1",
    payload: { task: "Need stone soon" },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.equal(dug[0]?.x, visibleStone.x);
  assert.equal(dug[0]?.y, visibleStone.y);
  assert.equal(dug[0]?.z, visibleStone.z);
  const mineResult = results.find((result) => result.action === "mine_block");
  assert.equal(mineResult?.ok, true, mineResult?.error);
  assert.equal(requests.filter((request) => request.schemaName === "AgentDecision").length, 1);
  const rejectedTrace = traces.find((event) =>
    event.payload.rejected === true && event.payload.action === "mine_block",
  );
  assert.equal(rejectedTrace?.payload.source, "llm_repair");
  assert.match(String(rejectedTrace?.payload.reason ?? ""), /infeasible action rejected/);

  await live.stop();
});

test("live runtime sends one repair prompt when no feasible alternative qualifies", async () => {
  const agents = [agent("miner-1", "MinerOne", true)];
  const registry = new AgentRegistry(agents);
  let moves = 0;
  registry.attachBot("miner-1", miningBot("MinerOne", {
    pathfinder: {
      async goto() {
        moves += 1;
      },
      setGoal() {},
    },
  }));

  const eventBus = new StudioEventBus();
  const providers = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  let decisionRequests = 0;
  providers.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      if (request.schemaName === "AgentTaskPlan") {
        return { ok: true, value: schema.parse(planOutput("Need stone soon", "mine_block")) };
      }
      decisionRequests += 1;
      const value = decisionRequests === 1
        ? {
            intent: "mine invented stone target",
            action: "mine_block",
            parameters: { position: { x: 40, y: 64, z: 0 }, block: "stone" },
            confidence: 0.7,
            reasoningSummary: "Trying a distant stone target.",
          }
        : {
            intent: "move to scout for stone",
            action: "move_to",
            parameters: { position: { x: 8, y: 64, z: 0 }, range: 2 },
            confidence: 0.7,
            reasoningSummary: "Repair by scouting instead of mining invisible stone.",
          };
      return { ok: true, value: schema.parse(value) };
    },
  });

  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    providers,
    tickMs: 1_000,
    maxConcurrentActions: 1,
    maxPlanningSlots: 1,
    planningCooldownMs: 0,
  });

  eventBus.emit("director.command", {
    id: "stone-task",
    type: "set-agent-task",
    targetAgentId: "miner-1",
    payload: { task: "Need stone soon" },
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  const decisionCalls = requests.filter((request) => request.schemaName === "AgentDecision");
  assert.equal(decisionCalls.length, 2);
  assert.match(decisionCalls[1]?.messages.at(-1)?.content ?? "", /infeasible action/i);
  assert.equal(moves, 1);

  await live.stop();
});

test("live runtime respects configured allowedActions instead of auto-adding defaults", async () => {
  const limitedAgent: AgentConfig = {
    ...agent("guard-1", "GuardOne", true),
    allowedActions: ["move_to", "chat_ai_private"],
  };
  const agents = [limitedAgent];
  const registry = new AgentRegistry(agents);
  let moves = 0;
  registry.attachBot("guard-1", fakeBot({
    username: "GuardOne",
    health: 6,
    entity: {
      id: "guard-1",
      type: "player",
      username: "GuardOne",
      position: { x: 0, y: 64, z: 0 },
    },
    entities: {
      zombie: {
        id: "zombie-1",
        type: "mob",
        name: "zombie",
        position: { x: 5, y: 64, z: 0 },
      },
    },
    pathfinder: {
      async goto() {
        moves += 1;
      },
      setGoal() {},
    },
  }));

  const eventBus = new StudioEventBus();
  const results: ActionResult[] = [];
  eventBus.subscribe("action.result", (result) => results.push(result));
  const providers = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  providers.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      if (request.schemaName === "AgentTaskPlan") {
        return { ok: true, value: schema.parse(planOutput("Move away from danger", "move_to")) };
      }
      return {
        ok: true,
        value: schema.parse({
          intent: "move away from danger with allowed movement",
          action: "move_to",
          parameters: { position: { x: 1, y: 64, z: 0 }, range: 2 },
          confidence: 0.75,
          reasoningSummary: "Use an allowed movement action because flee is not configured.",
        }),
      };
    },
  });
  const live = createLiveAgentRuntime({
    agents,
    registry,
    eventBus,
    providers,
    tickMs: 1_000,
    maxConcurrentActions: 1,
    maxPlanningSlots: 1,
    planningCooldownMs: 0,
  });

  eventBus.emit("game.event", {
    id: "damage-1",
    type: "player_damage",
    targetId: "guard-1",
    severity: 4,
    visibility: "ai",
    payload: {},
    timestamp: new Date(0).toISOString(),
  });

  await live.scheduler.tick();
  await live.scheduler.waitForIdle();
  await live.scheduler.waitForIdle();

  assert.equal(limitedAgent.allowedActions.includes("flee"), false);
  assert.equal(moves, 1);
  assert.ok(results.some((result) => result.ok && result.action === "move_to"));
  assert.equal(results.some((result) => result.action === "flee"), false);
  const prompt = requests.find((request) => request.schemaName === "AgentDecision")?.messages[0]?.content ?? "";
  assert.match(prompt, /chat_ai_private:/);
  assert.doesNotMatch(prompt, /flee:/);
  assert.doesNotMatch(prompt, /attack_entity:/);

  await live.stop();
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

function miningBot(
  username: string,
  options: {
    stonePosition?: Position;
    onDig?: (position: Position) => void;
    pathfinder?: BotHandle["pathfinder"];
  } = {},
): BotHandle {
  const position = { x: 0, y: 64, z: 0 };
  return fakeBot({
    username,
    entity: {
      id: username,
      type: "player",
      username,
      position,
    },
    inventory: {
      items: () => [],
      emptySlotCount: () => 4,
    },
    blockAt(target) {
      if (options.stonePosition && sameBlockPosition(target, options.stonePosition)) {
        return { name: "stone", position: target, diggable: true };
      }
      return { name: "air", position: target, diggable: false };
    },
    canDigBlock() {
      return true;
    },
    async dig(block) {
      options.onDig?.(block.position);
    },
    pathfinder: options.pathfinder ?? {
      async goto() {},
      setGoal() {},
    },
  });
}

function planOutput(goal: string, nextAction: string) {
  return {
    goal,
    currentStepId: "act",
    steps: [
      {
        id: "act",
        description: "Make concrete progress on the assigned task",
        status: "active",
        successCondition: "the next action makes progress",
        nextAction,
      },
      {
        id: "report",
        description: "Report blockers or completion",
        status: "pending",
        successCondition: "leader knows the result",
        nextAction: "chat_ai_private",
      },
      {
        id: "continue",
        description: "Continue useful work",
        status: "pending",
        successCondition: "task remains active",
        nextAction,
      },
    ],
    reasoningSummary: "Use the next concrete action.",
  };
}

function sameBlockPosition(left: Position, right: Position): boolean {
  return Math.floor(left.x) === Math.floor(right.x)
    && Math.floor(left.y) === Math.floor(right.y)
    && Math.floor(left.z) === Math.floor(right.z);
}
