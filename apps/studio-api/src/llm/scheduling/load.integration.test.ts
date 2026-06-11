import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { AgentDecisionService } from "../decisions";
import { LlmProviderRegistry } from "../providers";
import { DeterministicMockLlmProvider, mockLlmProviderError } from "../testing/mock-provider";
import { PlanningCooldown } from "./cooldown";
import { PlanningDispatcher } from "./dispatcher";
import { PriorityPlanningQueue } from "./priority-queue";
import { LlmRateLimiter } from "./rate-limiter";
import type { LlmPlanningTask } from "./types";

test("20-agent LLM load respects queue limits, rate limits, fallbacks, and max concurrency", async () => {
  const agents = Array.from({ length: 20 }, (_, index) => agent(index));
  const queue = new PriorityPlanningQueue();
  for (const item of agents) {
    queue.enqueue(task(item.id));
  }

  const limiter = new LlmRateLimiter({
    globalRequestsPerMinute: 8,
    providerRequestsPerMinute: { mock: 6 },
    windowMs: 60_000,
  });
  const dispatcher = new PlanningDispatcher(
    queue,
    limiter,
    new PlanningCooldown(0),
    { maxConcurrentPlanning: 4 },
  );
  const registry = new LlmProviderRegistry();
  registry.register(new DeterministicMockLlmProvider((request, callIndex) => {
    if (request.schemaName !== "AgentDecision") {
      throw new Error(`unexpected schema: ${request.schemaName}`);
    }
    if (callIndex % 3 === 0) {
      return mockLlmProviderError("mock_rate_limited", "mock provider overloaded", true);
    }
    return {
      intent: "keep_working",
      action: "continue_routine",
      parameters: { routineId: "routine" },
      confidence: 0.74,
      reasoningSummary: "Continue assigned routine under load.",
    };
  }));
  const service = new AgentDecisionService(registry);

  let maxActiveObserved = 0;
  let processed = 0;
  let fallbackCount = 0;
  let batch = dispatcher.startReady(0);

  while (batch.length > 0) {
    maxActiveObserved = Math.max(maxActiveObserved, dispatcher.activeCount());
    assert.ok(dispatcher.activeCount() <= 4);

    const decisions = await Promise.all(batch.map(async (started) => {
      const currentAgent = agents.find((item) => item.id === started.plannerAgentId);
      assert.ok(currentAgent);
      return service.decide({
        agent: currentAgent,
        model: { provider: "mock", model: "mock-v1", timeoutMs: 1_000 },
        staticPersona: { identity: `${currentAgent.name} follows the assigned role.` },
        dynamicState: { currentRoutine: currentAgent.routine },
        availableActions: ["idle", "continue_routine"],
        maxContextChars: 1_000,
      });
    }));

    processed += decisions.length;
    fallbackCount += decisions.filter((decision) => decision.fallback).length;
    batch.forEach((started) => dispatcher.complete(started.id));
    batch = dispatcher.startReady(0);
  }

  assert.equal(processed, 6);
  assert.equal(fallbackCount, 2);
  assert.equal(maxActiveObserved, 4);
  assert.equal(limiter.usage("mock", 0).provider, 6);
  assert.equal(limiter.usage("mock", 0).global, 6);
  assert.equal(queue.size(), 14);
  assert.equal(queue.all().every((item) => (item.notBefore ?? 0) > 0), true);
});

function agent(index: number): AgentConfig {
  const id = `agent-${index.toString().padStart(2, "0")}`;
  return {
    id,
    name: id,
    account: { username: `${id}-bot`, auth: "offline" },
    role: index === 0 ? "leader" : "farmer",
    team: "village",
    mode: "routine",
    routine: "routine",
    allowedActions: ["idle", "continue_routine"],
    providerRef: "mock",
  };
}

function task(agentId: string): LlmPlanningTask {
  return {
    id: `task-${agentId}`,
    provider: "mock",
    plannerAgentId: agentId,
    agentIds: [agentId],
    reason: { type: "routine_tick" },
    severity: 1,
    enqueuedAt: 0,
  };
}
