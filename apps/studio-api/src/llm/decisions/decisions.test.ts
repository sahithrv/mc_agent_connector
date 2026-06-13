import assert from "node:assert/strict";
import test from "node:test";

import { LlmProviderRegistry } from "../providers";
import { llmError, type LlmProvider, type LlmRequest } from "../providers/types";
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

test("decision service includes recent action results in the decision prompt", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "craft a tool",
    action: "craft_item",
    parameters: { item: "wooden_pickaxe" },
    confidence: 0.8,
    reasoningSummary: "Recent mining failed because a valid tool was missing.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    recentActionResults: [{
      action: "mine_block",
      ok: false,
      params: { block: "iron_ore", position: { x: 12, y: 64, z: -9 } },
      error: "missing valid tool for block: iron_ore",
      requestedBy: "llm",
      targetKey: "block:iron_ore",
      completedAt: "2026-06-12T00:00:01.000Z",
    }],
    availableActions: ["idle", "continue_routine", "craft_item"],
  });

  const prompt = result.request.messages[0]?.content ?? "";
  assert.match(prompt, /RECENT_ACTION_RESULTS/);
  assert.match(prompt, /mine_block target=iron_ore@12,64,-9 ok=false/);
  assert.match(prompt, /missing valid tool for block: iron_ore/);
  assert.match(prompt, /do not repeat the same failed action-target pair/);
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

test("fallback collects visible useful item before continuing routine", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(timeoutProvider());

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    perception: {
      nearbyItems: [{
        id: "drop-1",
        kind: "item",
        name: "coal",
        position: { x: 3, y: 64, z: 2 },
        distance: 4,
      }],
    },
    availableActions: ["idle", "continue_routine", "collect_item"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "collect_item");
  assert.equal(result.decision.parameters.entityId, "drop-1");
  assert.equal(result.decision.parameters.item, "coal");
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("fallback mines visible safe block before continuing routine", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(timeoutProvider());

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    perception: {
      visibleBlocks: [{
        id: "stone-1",
        type: "stone",
        position: { x: 4, y: 64, z: 1 },
        safe: true,
      }],
    },
    availableActions: ["idle", "continue_routine", "mine_block"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "mine_block");
  assert.equal(result.decision.parameters.block, "stone");
  assert.deepEqual(result.decision.parameters.position, { x: 4, y: 64, z: 1 });
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("fallback crafts obvious missing tool before continuing routine", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(timeoutProvider());

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    dynamicState: {
      health: 16,
      currentRoutine: "miner",
      activeGoal: "mine stone for a base",
    },
    perception: {
      inventory: [
        { name: "oak_planks", count: 3 },
        { name: "stick", count: 2 },
      ],
    },
    availableActions: ["idle", "continue_routine", "craft_item"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "craft_item");
  assert.equal(result.decision.parameters.item, "wooden_pickaxe");
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("fallback moves to patrol point before continuing routine", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(timeoutProvider());

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    perception: {
      patrolPoints: [{ x: 8, y: 64, z: 0 }],
    },
    availableActions: ["idle", "continue_routine", "move_to"],
  });

  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "move_to");
  assert.deepEqual(result.decision.parameters.position, { x: 8, y: 64, z: 0 });
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
});

test("invalid provider decision gets one repair attempt before fallback", async () => {
  const registry = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  registry.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      if (requests.length === 1) {
        return {
          ok: true,
          value: {
            intent: "wait",
            action: "idle",
            confidence: 0.2,
          } as never,
        };
      }
      return {
        ok: true,
        value: schema.parse({
          intent: "scout",
          action: "move_to",
          parameters: { position: { x: 2, y: 64, z: 2 } },
          confidence: 0.7,
          reasoningSummary: "Repairing invalid JSON with a concrete scout move.",
        }),
      };
    },
  });

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "move_to"],
  });

  assert.equal(requests.length, 2);
  assert.equal(result.fallback, false);
  assert.equal(result.repaired, true);
  assert.equal(result.decision.action, "move_to");
  assert.match(lastMessage(requests[1]), /previous AgentDecision was rejected/i);
  assert.match(lastMessage(requests[1]), /ACTION_PARAMETER_RULES/);
});

test("unavailable provider action falls back safely", async () => {
  const registry = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  registry.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      return {
        ok: true,
        value: schema.parse({
          intent: "mine_resource",
          action: "mine_block",
          parameters: { block: "stone" },
          confidence: 0.7,
          reasoningSummary: "Wanted stone.",
        }),
      };
    },
  });

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine"],
  });

  assert.equal(requests.length, 2);
  assert.equal(result.fallback, true);
  assert.equal(result.decision.action, "continue_routine");
  assert.match(result.fallbackReason ?? "", /unavailable action/);
  assert.equal(result.rejection?.code, "unavailable_action");
  assert.match(lastMessage(requests[1]), /provider chose unavailable action: mine_block/);
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

test("provider decision with missing execution parameters can be repaired", async () => {
  const registry = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  registry.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      const decision = requests.length === 1
        ? {
            intent: "move somewhere",
            action: "move_to",
            parameters: {},
            confidence: 0.7,
            reasoningSummary: "Wanted to move but omitted the target.",
          }
        : {
            intent: "scout",
            action: "move_to",
            parameters: { position: { x: 5, y: 64, z: 5 }, range: 2 },
            confidence: 0.75,
            reasoningSummary: "Repairing with a concrete visible scout target.",
          };
      return { ok: true, value: schema.parse(decision) };
    },
  });

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "move_to"],
  });

  assert.equal(requests.length, 2);
  assert.equal(result.fallback, false);
  assert.equal(result.repaired, true);
  assert.equal(result.decision.action, "move_to");
  assert.deepEqual(result.decision.parameters.position, { x: 5, y: 64, z: 5 });
  assert.match(lastMessage(requests[1]), /move_to requires position/);
  assert.deepEqual(AgentDecisionSchema.parse(result.decision), result.decision);
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

function timeoutProvider(): LlmProvider {
  return {
    name: "mock",
    async generateStructured() {
      return llmError("timeout", "mock timed out", true);
    },
  };
}

function lastMessage(request: LlmRequest | undefined): string {
  if (!request) {
    return "";
  }
  return request.messages[request.messages.length - 1]?.content ?? "";
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
