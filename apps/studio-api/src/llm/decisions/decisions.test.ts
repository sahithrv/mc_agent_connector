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
    perception: {
      nearbyEntities: [{
        id: "zombie-1",
        type: "zombie",
        hostile: true,
        position: { x: 2, y: 64, z: 2 },
      }],
    },
    availableActions: ["idle", "continue_routine", "flee"],
  });

  assert.equal(result.fallback, true);
  assert.match(result.fallbackReason ?? "", /timeout/);
  assert.equal(result.decision.action, "flee");
  assert.equal(result.decision.parameters.entityId, "zombie-1");
  assert.match(result.decision.reasoningSummary, /Fallback flee/);
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("threat fallback does not choose flee without a visible flee origin", async () => {
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
  assert.equal(result.decision.action, "continue_routine");
  assert.match(result.decision.reasoningSummary, /Fallback continue routine/);
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
  assert.equal(result.rejection?.code, "unavailable_action");
});

test("provider decision with missing execution parameters falls back before action dispatch", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "move somewhere",
    action: "move_to",
    parameters: {},
    confidence: 0.7,
    reasoningSummary: "Wanted to move but omitted the target.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "move_to"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "continue_routine");
  assert.equal(result.rejection?.code, "missing_parameter");
  assert.equal(result.rejection?.path, "parameters.position");
  assert.match(result.fallbackReason ?? "", /move_to requires position/);
});

test("provider decision with mismatched speech visibility falls back safely", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "warn privately",
    action: "chat_public",
    parameters: { message: "Keep this private." },
    speech: {
      visibility: "ai",
      content: "Keep this private.",
    },
    confidence: 0.7,
    reasoningSummary: "Wanted a private warning but chose public chat.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "chat_public"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.rejection?.code, "speech_visibility_mismatch");
  assert.equal(result.decision.action, "continue_routine");
});

test("provider flee decision with distance only falls back before movement dispatch", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "retreat",
    action: "flee",
    parameters: { distance: 16 },
    confidence: 0.6,
    reasoningSummary: "Wanted to flee without identifying a threat origin.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "flee"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.rejection?.code, "missing_parameter");
  assert.match(result.fallbackReason ?? "", /flee requires position/);
  assert.equal(result.decision.action, "continue_routine");
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
