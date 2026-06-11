import assert from "node:assert/strict";
import test from "node:test";

import { LlmProviderRegistry } from "../providers";
import { llmError, type LlmProvider } from "../providers/types";
import { AgentDecisionSchema, type AgentDecision } from "../schemas/agent-decision";
import { AgentDecisionService } from "./service";

test("decision service returns validated AgentDecision from mock provider", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "wait",
    action: "idle",
    parameters: { durationMs: 500 },
    confidence: 0.8,
    reasoningSummary: "No urgent stimulus.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide(baseInput());

  assert.equal(result.fallback, false);
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
  assert.equal(result.decision.action, "idle");
  assert.equal(result.request.schemaName, "AgentDecision");
  assert.match(result.request.messages[0]?.content ?? "", /AVAILABLE_ACTIONS/);
});

test("provider error returns safe fallback with reason", async () => {
  const registry = new LlmProviderRegistry();
  registry.register({
    name: "mock",
    async generateStructured() {
      return llmError("timeout", "mock timed out", true);
    },
  });

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    dynamicState: { health: 5, threatLevel: "high", currentRoutine: "farmer" },
    availableActions: ["idle", "continue_routine", "flee"],
  });

  assert.equal(result.fallback, true);
  assert.match(result.fallbackReason ?? "", /timeout/);
  assert.equal(result.decision.action, "flee");
  assert.match(result.decision.reasoningSummary, /Fallback flee/);
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("unavailable provider action falls back safely", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "mine_resource",
    action: "mine_block",
    parameters: { block: "stone" },
    confidence: 0.7,
    reasoningSummary: "Wanted stone.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "continue_routine");
  assert.match(result.fallbackReason ?? "", /unavailable action/);
});

function mockProvider(decision: AgentDecision): LlmProvider {
  return {
    name: "mock",
    async generateStructured(_request, schema) {
      return { ok: true, value: schema.parse(decision), usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

function baseInput(): Parameters<AgentDecisionService["decide"]>[0] {
  return {
    agent: {
      id: "farmer-1",
      name: "Mira",
      role: "farmer",
      team: "village",
      routine: "farmer",
      allowedActions: ["idle", "chat_ai_private", "flee"],
    },
    model: {
      provider: "mock",
      model: "mock-model",
      timeoutMs: 1_000,
    },
    staticPersona: {
      identity: "Mira is a practical farmer.",
      speakingStyle: "brief",
    },
    dynamicState: {
      health: 16,
      currentRoutine: "farmer",
    },
    maxContextChars: 1_500,
  };
}
