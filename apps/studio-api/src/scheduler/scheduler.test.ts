import test from "node:test";
import assert from "node:assert/strict";

import type { ActionRequest, ActionResult, AgentConfig, GameEvent } from "@mc-ai-video/contracts";

import { AgentScheduler } from "./scheduler";
import type { ActionRegistry, DecisionPlanner, SchedulerEvent } from "./types";
import type { PerceptionProvider } from "./types";
import { FarmerRoutine, defaultRoutines, type PerceptionSnapshot, type Routine } from "../routines";

test("20 agents tick without exceeding configured LLM planning slots", async () => {
  const agents = Array.from({ length: 20 }, (_, index) => agent(`agent-${index}`));
  let inFlight = 0;
  let maxSeen = 0;
  let planCalls = 0;
  let resolvers: Array<() => void> = [];

  const planner: DecisionPlanner = {
    async plan() {
      planCalls += 1;
      inFlight += 1;
      maxSeen = Math.max(maxSeen, inFlight);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      inFlight -= 1;
      return {};
    },
  };

  const scheduler = createScheduler({ agents, planner, maxPlanningSlots: 3 });
  agents.forEach((item) => scheduler.queuePlanning(item.id));

  while (planCalls < agents.length) {
    await scheduler.tick();
    await Promise.resolve();
    assert.ok(scheduler.activePlanningCount() <= 3);
    assert.ok(maxSeen <= 3);
    const batch = resolvers;
    resolvers = [];
    batch.forEach((resolve) => resolve());
    await scheduler.waitForIdle();
  }

  assert.equal(planCalls, 20);
  assert.ok(maxSeen <= 3);
});

test("planning slots rotate across queued agents when slots are limited", async () => {
  const agents = [agent("a"), agent("b"), agent("c")];
  const started: string[] = [];
  let resolvers: Array<() => void> = [];
  const scheduler = createScheduler({
    agents,
    maxPlanningSlots: 1,
    planner: {
      async plan(item) {
        started.push(item.id);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return {};
      },
    },
  });

  agents.forEach((item) => scheduler.queuePlanning(item.id));

  await scheduler.tick();
  await Promise.resolve();
  assert.deepEqual(started, ["a"]);
  resolvers.shift()?.();
  await scheduler.waitForIdle();

  await scheduler.tick();
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b"]);
  resolvers.shift()?.();
  await scheduler.waitForIdle();

  await scheduler.tick();
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b", "c"]);
  resolvers.shift()?.();
  await scheduler.waitForIdle();

  agents.forEach((item) => scheduler.queuePlanning(item.id));
  await scheduler.tick();
  await Promise.resolve();
  assert.deepEqual(started, ["a", "b", "c", "a"]);
  resolvers.shift()?.();
  await scheduler.waitForIdle();
});

test("severe events wake targeted agents and request reflection", () => {
  const agents = [
    agent("leader", "leader", "red"),
    agent("farmer", "farmer", "red"),
    agent("guard", "guard", "red"),
    agent("observer", "miner", "blue"),
  ];
  const reflections: string[][] = [];
  const scheduler = createScheduler({
    agents,
    reflection: {
      requestReflection(request) {
        reflections.push(request.agentIds);
      },
    },
  });

  scheduler.handleEvent(event("attacked", "leader", "farmer", 4));

  assert.equal(scheduler.stateFor("leader")?.planningQueued, true);
  assert.equal(scheduler.stateFor("farmer")?.planningQueued, true);
  assert.equal(scheduler.stateFor("guard")?.planningQueued, true);
  assert.equal(scheduler.stateFor("observer")?.planningQueued, false);
  assert.deepEqual(reflections, [["leader", "farmer", "guard"]]);
});

test("long actions are canceled when an agent is attacked", async () => {
  const farmer = agent("farmer", "farmer", "red", "farmer", ["harvest_crop"]);
  let aborted = false;
  const events: SchedulerEvent[] = [];
  const actions: ActionRegistry = {
    canRun: () => true,
    async run(_agent, request, signal) {
      return new Promise<ActionResult>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve(result(request, false, "canceled"));
        }, { once: true });
      });
    },
  };
  const scheduler = createScheduler({
    agents: [farmer],
    actions,
    routines: new Map([["farmer", new FarmerRoutine()]]),
    events: { publish: (item) => events.push(item) },
    perception: {
      async snapshot() {
        return perception("farmer", {
          inventory: { tools: ["hoe"], seeds: 4 },
          visibleBlocks: [
            {
              id: "wheat-1",
              type: "wheat_crop",
              mature: true,
              safe: true,
              position: { x: 1, y: 64, z: 1 },
            },
          ],
        });
      },
    },
  });

  await scheduler.tick();
  assert.equal(scheduler.activeActionCount(), 1);
  scheduler.handleEvent(event("attacked", "zombie", "farmer", 4));
  await scheduler.waitForIdle();

  assert.equal(aborted, true);
  assert.equal(scheduler.activeActionCount(), 0);
  assert.ok(events.some((item) => item.type === "scheduler.action.canceled"));
});

test("planned actions queue when action slots are full and run later", async () => {
  const agents = [agent("a"), agent("b"), agent("c")];
  const started: string[] = [];
  const queued: string[] = [];
  const resolvers: Array<() => void> = [];
  const scheduler = createScheduler({
    agents,
    maxConcurrentActions: 1,
    maxPlanningSlots: 3,
    events: {
      publish(event) {
        if (event.type === "scheduler.action.queued") queued.push(event.agentId);
      },
    },
    planner: {
      async plan(agent) {
        return {
          action: {
            action: "idle",
            params: { durationMs: 1 },
            timeoutMs: 1_000,
            requestedBy: "test",
          },
          note: agent.id,
        };
      },
    },
    actions: {
      canRun: () => true,
      async run(_agent, request) {
        started.push(request.agentId);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return result(request, true);
      },
    },
  });

  agents.forEach((item) => scheduler.queuePlanning(item.id));
  await scheduler.tick();
  await Promise.resolve();

  assert.deepEqual(started, ["a"]);
  assert.deepEqual(queued.sort(), ["b", "c"]);

  resolvers.shift()?.();
  await scheduler.waitForIdle();
  await scheduler.tick();
  assert.deepEqual(started, ["a", "b"]);

  resolvers.shift()?.();
  await scheduler.waitForIdle();
  await scheduler.tick();
  assert.deepEqual(started, ["a", "b", "c"]);

  resolvers.shift()?.();
  await scheduler.waitForIdle();
});

test("paused agents ignore wakeups until resumed", async () => {
  const ada = agent("ada");
  let planCalls = 0;
  const scheduler = createScheduler({
    agents: [ada],
    planner: {
      async plan() {
        planCalls += 1;
        return {};
      },
    },
  });

  scheduler.pauseAgent(ada.id);
  scheduler.queuePlanning(ada.id);
  await scheduler.tick();
  assert.equal(planCalls, 0);
  assert.equal(scheduler.stateFor(ada.id)?.planningQueued, false);

  scheduler.resumeAgent(ada.id);
  await scheduler.tick();
  await scheduler.waitForIdle();
  assert.equal(planCalls, 1);
});

test("survival precheck lets a farmer answer a nearby hostile before farmer idle", async () => {
  const farmer = agent("farmer", "farmer", "red", "farmer", ["idle", "attack_entity", "flee"]);
  const started: string[] = [];
  const scheduler = createScheduler({
    agents: [farmer],
    routines: defaultRoutines(),
    actions: {
      canRun: () => true,
      async run(_agent, request) {
        started.push(`${request.agentId}:${request.action}`);
        return result(request, true);
      },
    },
    perception: {
      async snapshot() {
        return perception("farmer", {
          health: 20,
          nearbyEntities: [
            {
              id: "zombie-1",
              type: "zombie",
              hostile: true,
              position: { x: 2, y: 64, z: 0 },
            },
          ],
        });
      },
    },
  });

  await scheduler.tick();
  await scheduler.waitForIdle();

  assert.deepEqual(started, ["farmer:attack_entity"]);
});

test("survival precheck lets a farmer collect a useful nearby drop before idle", async () => {
  const farmer = agent("farmer", "farmer", "red", "farmer", ["idle", "collect_item"]);
  const started: string[] = [];
  const scheduler = createScheduler({
    agents: [farmer],
    routines: defaultRoutines(),
    actions: {
      canRun: () => true,
      async run(_agent, request) {
        started.push(`${request.agentId}:${request.action}`);
        return result(request, true);
      },
    },
    perception: {
      async snapshot() {
        return perception("farmer", {
          nearbyEntities: [
            {
              id: "seeds-1",
              type: "wheat_seeds",
              hostile: false,
              position: { x: 1, y: 64, z: 0 },
            },
          ],
        });
      },
    },
  });

  await scheduler.tick();
  await scheduler.waitForIdle();

  assert.deepEqual(started, ["farmer:collect_item"]);
});

test("routine idle does not monopolize action slots", async () => {
  const agents = [
    agent("farmer", "farmer", "red", "farmer", ["idle"]),
    agent("miner", "miner", "red", "miner", ["mine_block"]),
  ];
  const started: string[] = [];
  const scheduler = createScheduler({
    agents,
    routines: defaultRoutines(),
    maxConcurrentActions: 1,
    actions: {
      canRun: () => true,
      async run(_agent, request) {
        started.push(`${request.agentId}:${request.action}`);
        return result(request, true);
      },
    },
    perception: {
      async snapshot(item) {
        if (item.id === "miner") {
          return perception("miner", {
            inventory: { tools: ["wooden_pickaxe"], seeds: 0 },
            visibleBlocks: [
              {
                id: "stone-1",
                type: "stone",
                position: { x: 1, y: 64, z: 0 },
                safe: true,
              },
            ],
          });
        }
        return perception("farmer");
      },
    },
  });

  await scheduler.tick();
  await scheduler.waitForIdle();

  assert.deepEqual(started, ["miner:mine_block"]);
  assert.equal(started.includes("farmer:idle"), false);
});

function createScheduler(overrides: {
  agents: AgentConfig[];
  planner?: DecisionPlanner;
  perception?: PerceptionProvider;
  actions?: ActionRegistry;
  routines?: Map<string, Routine>;
  events?: { publish(event: SchedulerEvent): void };
  reflection?: { requestReflection(request: { agentIds: string[] }): void };
  maxPlanningSlots?: number;
  maxConcurrentActions?: number;
}): AgentScheduler {
  return new AgentScheduler({
    agents: overrides.agents,
    routines: overrides.routines ?? new Map(),
    perception: overrides.perception ?? { async snapshot(item) { return perception(item.id); } },
    actions: overrides.actions ?? {
      canRun: () => true,
      async run(_agent, request) {
        return result(request, true);
      },
    },
    planner: overrides.planner ?? { async plan() { return {}; } },
    events: overrides.events,
    reflection: overrides.reflection,
    config: {
      maxConcurrentActions: overrides.maxConcurrentActions ?? 4,
      maxPlanningSlots: overrides.maxPlanningSlots ?? 2,
      planningCooldownMs: 0,
    },
  });
}

function agent(
  id: string,
  role = "farmer",
  team = "red",
  routine = role,
  allowedActions = ["idle"],
): AgentConfig {
  return {
    id,
    name: id,
    account: { username: `${id}-bot`, auth: "offline" },
    role,
    team,
    mode: "routine",
    routine,
    allowedActions,
    providerRef: "mock",
  };
}

function perception(
  agentId: string,
  overrides: Partial<PerceptionSnapshot> = {},
): PerceptionSnapshot {
  return {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
    ...overrides,
  };
}

function event(
  type: string,
  actorId: string,
  targetId: string,
  severity: 1 | 2 | 3 | 4 | 5,
): GameEvent {
  return {
    id: `${type}-1`,
    type,
    actorId,
    targetId,
    severity,
    visibility: "ai",
    payload: {},
    timestamp: new Date(0).toISOString(),
  };
}

function result(request: ActionRequest, ok: boolean, error?: string): ActionResult {
  return {
    requestId: request.id,
    agentId: request.agentId,
    action: request.action,
    ok,
    startedAt: request.createdAt,
    completedAt: request.createdAt,
    error,
  };
}
