import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig, GameEvent } from "@mc-ai-video/contracts";
import { z } from "zod";

import type { LlmRequest } from "../providers/types";
import { PlanningCooldown } from "./cooldown";
import { PlanningDispatcher } from "./dispatcher";
import { ScheduledLlmExecutor } from "./executor";
import { createPlanningTasksFromWake } from "./group-planning";
import { PriorityPlanningQueue } from "./priority-queue";
import { LlmRateLimiter } from "./rate-limiter";
import { executeWithRetry } from "./retry";
import type { LlmPlanningTask } from "./types";
import { routeLlmWakeEvent } from "./wake-rules";

test("per-provider and global rate limits cap 20-agent request bursts", () => {
  const limiter = new LlmRateLimiter({
    globalRequestsPerMinute: 5,
    providerRequestsPerMinute: { openai: 3 },
    windowMs: 60_000,
  });

  const openAiDecisions = Array.from({ length: 4 }, () => limiter.tryAcquire("openai", 0));
  assert.deepEqual(openAiDecisions.map((item) => item.ok), [true, true, true, false]);
  assert.equal(openAiDecisions[3]?.ok, false);
  if (openAiDecisions[3] && !openAiDecisions[3].ok) {
    assert.equal(openAiDecisions[3].scope, "provider");
  }

  assert.equal(limiter.tryAcquire("anthropic", 0).ok, true);
  assert.equal(limiter.tryAcquire("anthropic", 0).ok, true);
  const globalDenied = limiter.tryAcquire("deepseek", 0);
  assert.equal(globalDenied.ok, false);
  if (!globalDenied.ok) assert.equal(globalDenied.scope, "global");
});

test("priority queue and dispatcher keep severe events ahead of routine work", () => {
  const queue = new PriorityPlanningQueue();
  queue.enqueue(task("routine", "agent-1", "routine_tick", 1, 0));
  queue.enqueue(task("attack", "agent-2", "attacked", 5, 10));

  const first = queue.dequeueReady(10);
  assert.equal(first?.id, "attack");
});

test("dispatcher enforces planning slots, cooldowns, and RPM for 20 agents", () => {
  const queue = new PriorityPlanningQueue();
  for (let index = 0; index < 20; index += 1) {
    queue.enqueue(task(`task-${index}`, `agent-${index}`, "routine_tick", 1, 0));
  }

  const limiter = new LlmRateLimiter({ globalRequestsPerMinute: 5, windowMs: 60_000 });
  const cooldown = new PlanningCooldown(1_000);
  const dispatcher = new PlanningDispatcher(queue, limiter, cooldown, {
    maxConcurrentPlanning: 3,
  });

  const firstBatch = dispatcher.startReady(0);
  assert.equal(firstBatch.length, 3);
  assert.equal(dispatcher.activeCount(), 3);
  assert.equal(limiter.usage("mock", 0).global, 3);

  firstBatch.forEach((item) => dispatcher.complete(item.id));
  const secondBatch = dispatcher.startReady(0);
  assert.equal(secondBatch.length, 2);
  assert.equal(limiter.usage("mock", 0).global, 5);

  secondBatch.forEach((item) => dispatcher.complete(item.id));
  assert.equal(dispatcher.startReady(0).length, 0);
  assert.ok(queue.size() > 0);
});

test("planning cooldown prevents the same agent from planning too often", () => {
  const cooldown = new PlanningCooldown(1_000);
  assert.equal(cooldown.canPlan("farmer", 0), true);
  cooldown.markPlanned(["farmer"], 0);
  assert.equal(cooldown.canPlan("farmer", 999), false);
  assert.equal(cooldown.canPlan("farmer", 1_000), true);
});

test("wake rules target relevant agents and leave irrelevant agents routine", () => {
  const agents = [
    agent("leader", "leader", "red"),
    agent("farmer", "farmer", "red"),
    agent("guard", "guard", "red"),
    agent("observer", "miner", "blue"),
  ];

  const routed = routeLlmWakeEvent(event("attacked", "leader", "farmer", 5), agents);
  assert.deepEqual(routed.wakeAgentIds, ["farmer", "guard", "leader"]);
  assert.deepEqual(routed.routineAgentIds, ["observer"]);

  const mention = routeLlmWakeEvent({
    ...event("chat.direct_mention", "observer", undefined, 3),
    payload: { mentionedAgentIds: ["farmer"] },
  }, agents);
  assert.deepEqual(mention.wakeAgentIds, ["farmer"]);
  assert.deepEqual(mention.routineAgentIds, ["guard", "leader", "observer"]);

  const death = routeLlmWakeEvent(event("agent.death", "farmer", undefined, 5), agents);
  assert.deepEqual(death.wakeAgentIds, ["farmer"]);
  assert.deepEqual(death.routineAgentIds, ["guard", "leader", "observer"]);

  const diamonds = routeLlmWakeEvent(event("miner.found_diamonds", "farmer", undefined, 4), agents);
  assert.deepEqual(diamonds.wakeAgentIds, ["farmer", "leader"]);
  assert.deepEqual(diamonds.routineAgentIds, ["guard", "observer"]);

  const command = routeLlmWakeEvent(event("chat.leader_command", "leader", undefined, 4), agents);
  assert.deepEqual(command.wakeAgentIds, ["farmer", "guard"]);
  assert.deepEqual(command.routineAgentIds, ["leader", "observer"]);

  const betrayal = routeLlmWakeEvent(event("agent.betrayal", "leader", "farmer", 5), agents);
  assert.deepEqual(betrayal.wakeAgentIds, ["farmer", "guard", "leader"]);
  assert.deepEqual(betrayal.routineAgentIds, ["observer"]);
});

test("group planning reduces calls for 20-agent leader command scenarios", () => {
  const agents = Array.from({ length: 20 }, (_, index) =>
    agent(index === 0 ? "leader" : `agent-${index}`, index === 0 ? "leader" : "farmer", "red"),
  );
  const routed = routeLlmWakeEvent(event("chat.leader_command", "leader", undefined, 4), agents);

  const individual = createPlanningTasksFromWake({
    agents,
    routing: routed,
    now: 0,
    options: { enabled: false },
  });
  const grouped = createPlanningTasksFromWake({
    agents,
    routing: routed,
    now: 0,
    options: { enabled: true, minGroupSize: 2 },
  });

  assert.equal(individual.length, 19);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.plannerAgentId, "leader");
  assert.equal(grouped[0]?.agentIds.length, 19);
});

test("retry policy retries retryable errors only and skips validation errors", async () => {
  let retryableAttempts = 0;
  const retryable = await executeWithRetry(async () => {
    retryableAttempts += 1;
    if (retryableAttempts < 3) {
      return {
        ok: false,
        error: { code: "provider_request_failed", message: "HTTP 500", retryable: true },
      };
    }
    return { ok: true, value: { ok: true } };
  }, {
    maxAttempts: 4,
    baseDelayMs: 100,
    jitterRatio: 0,
    sleep: async () => undefined,
  });

  assert.equal(retryable.result.ok, true);
  assert.equal(retryable.attempts, 3);
  assert.deepEqual(retryable.delaysMs, [100, 200]);

  let validationAttempts = 0;
  const validation = await executeWithRetry(async () => {
    validationAttempts += 1;
    return {
      ok: false,
      error: {
        code: "schema_validation_failed",
        message: "invalid action",
        retryable: false,
      },
    };
  }, { maxAttempts: 4, sleep: async () => undefined });

  assert.equal(validation.result.ok, false);
  assert.equal(validation.attempts, 1);
  assert.equal(validationAttempts, 1);
});

test("stalled provider returns timeout fallback without blocking scheduler", async () => {
  const schema = z.object({ action: z.literal("continue_routine") });
  const executor = new ScheduledLlmExecutor({
    async generateStructured() {
      return new Promise(() => undefined);
    },
  });

  const startedAt = Date.now();
  const result = await executor.generateStructured(request(), schema, () => ({
    action: "continue_routine" as const,
  }));

  assert.equal(result.timedOut, true);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.result.ok, true);
  if (result.result.ok) assert.deepEqual(result.result.value, { action: "continue_routine" });
  assert.ok(Date.now() - startedAt < 250);
});

function task(
  id: string,
  agentId: string,
  reason: LlmPlanningTask["reason"]["type"],
  severity: LlmPlanningTask["severity"],
  enqueuedAt: number,
): LlmPlanningTask {
  return {
    id,
    provider: "mock",
    plannerAgentId: agentId,
    agentIds: [agentId],
    reason: { type: reason },
    severity,
    enqueuedAt,
  };
}

function agent(id: string, role = "farmer", team = "red"): AgentConfig {
  return {
    id,
    name: id,
    account: { username: `${id}-bot`, auth: "offline" },
    role,
    team,
    mode: "routine",
    routine: role,
    allowedActions: ["idle", "continue_routine"],
    providerRef: "mock",
  };
}

function event(
  type: string,
  actorId: string,
  targetId: string | undefined,
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

function request(): LlmRequest {
  return {
    provider: "mock",
    model: "mock-model",
    system: "Return JSON.",
    messages: [{ role: "user", content: "plan" }],
    schemaName: "MockDecision",
    temperature: 0.2,
    timeoutMs: 10,
  };
}
