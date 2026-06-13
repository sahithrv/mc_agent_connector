import assert from "node:assert/strict";
import test from "node:test";

import { LlmProviderRegistry } from "../providers";
import { llmError, type LlmProvider, type LlmRequest } from "../providers/types";
import { AgentDecisionSchema, type AgentDecision } from "../schemas/agent-decision";
import { AgentPlanService } from "./plan-service";
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

test("decision service includes recovery section in the decision prompt", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "recover from blocked mining",
    action: "craft_item",
    parameters: { item: "stone_pickaxe" },
    confidence: 0.82,
    reasoningSummary: "Craft the missing tool before retrying the blocked target.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    recovery: {
      stuck: true,
      reason: "same failed action-target pair repeated within 60 seconds: mine_block:world:1,64,2",
      blockedTargetKeys: ["mine_block:world:1,64,2"],
      hint: "Avoid retrying mine_block:world:1,64,2; craft a stone pickaxe first.",
    },
    availableActions: ["idle", "continue_routine", "craft_item"],
  });

  const prompt = result.request.messages[0]?.content ?? "";
  assert.match(prompt, /RECOVERY/);
  assert.match(prompt, /blockedTargetKeys=mine_block:world:1,64,2/);
  assert.match(prompt, /choose a different action\/target or satisfy the blocker/);
});

test("decision service includes current task plan in the decision prompt", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    intent: "place shelter wall",
    action: "place_block",
    parameters: { position: { x: 4, y: 64, z: 2 }, block: "oak_planks" },
    confidence: 0.82,
    reasoningSummary: "Advance the active shelter plan step.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    taskState: {
      goal: "Build a starter shelter",
      currentStepId: "place-walls",
      updatedAt: "2026-06-13T00:00:00.000Z",
      plan: [
        {
          id: "place-walls",
          description: "Place wall blocks near the claimed site",
          status: "active",
          nextAction: "place_block",
          successCondition: "first wall blocks are placed",
        },
        {
          id: "roof",
          description: "Add roof blocks",
          status: "pending",
          nextAction: "place_block",
        },
      ],
    },
    availableActions: ["idle", "continue_routine", "place_block"],
  });

  const prompt = result.request.messages[0]?.content ?? "";
  assert.match(prompt, /CURRENT_PLAN/);
  assert.match(prompt, /goal=Build a starter shelter/);
  assert.match(prompt, /\[active\] place-walls/);
  assert.match(prompt, /nextAction=place_block/);
});

test("plan service requests a concise grounded AgentTaskPlan", async () => {
  const registry = new LlmProviderRegistry();
  const requests: LlmRequest[] = [];
  registry.register({
    name: "mock",
    async generateStructured(request, schema) {
      requests.push(request);
      return {
        ok: true,
        value: schema.parse({
          goal: "Gather wood for tools",
          currentStepId: "collect-wood",
          steps: [
            {
              id: "collect-wood",
              description: "Collect visible oak logs",
              status: "active",
              successCondition: "at least four logs are available",
              nextAction: "mine_block",
              target: { block: "oak_log" },
            },
            {
              id: "craft-planks",
              description: "Craft logs into planks",
              status: "pending",
              successCondition: "planks are in inventory",
              nextAction: "craft_item",
              neededItems: { oak_log: 1 },
            },
            {
              id: "craft-sticks",
              description: "Craft sticks for tools",
              status: "pending",
              successCondition: "sticks are in inventory",
              nextAction: "craft_item",
            },
          ],
          reasoningSummary: "Wood is visible and needed for tool crafting.",
        }),
        usage: { inputTokens: 12, outputTokens: 8 },
      };
    },
  });

  const service = new AgentPlanService(registry);
  const result = await service.updatePlan({
    ...baseInput(),
    goal: "Gather wood for tools",
    trigger: "new_goal",
    affordances: [{
      action: "mine_block",
      params: { block: "oak_log", position: { x: 2, y: 64, z: 1 } },
      score: 0.9,
      reason: "oak_log is visible and needed for tools",
      advancesGoal: true,
    }],
    availableActions: ["idle", "continue_routine", "mine_block", "craft_item"],
    availableSkills: ["gather_wood: mine visible logs and craft planks"],
  });

  assert.equal(result.fallback, false);
  assert.equal(result.request.schemaName, "AgentTaskPlan");
  assert.equal(requests.length, 1);
  assert.equal(result.plan.steps.length, 3);
  assert.equal(result.plan.currentStepId, "collect-wood");
  assert.equal(result.plan.steps[0]?.nextAction, "mine_block");
  assert.match(result.request.messages[0]?.content ?? "", /PLAN_UPDATE_TRIGGER=new_goal/);
  assert.match(result.request.messages[0]?.content ?? "", /Return 3 to 8 concise steps/);
  assert.match(result.request.messages[0]?.content ?? "", /EXECUTABLE_NOW/);
});

test("plan service falls back to an affordance-grounded plan on provider errors", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(timeoutProvider());

  const service = new AgentPlanService(registry);
  const result = await service.updatePlan({
    ...baseInput(),
    goal: "Mine stone for a base",
    trigger: "empty_plan",
    affordances: [
      {
        action: "craft_item",
        params: { item: "wooden_pickaxe" },
        score: 0.9,
        reason: "craft pickaxe to mine stone",
        advancesGoal: true,
      },
      {
        action: "mine_block",
        params: { block: "stone", position: { x: 1, y: 64, z: 2 } },
        score: 0.8,
        reason: "stone is visible",
        advancesGoal: true,
        blocked: true,
        blockedReason: "missing pickaxe",
      },
    ],
    availableActions: ["idle", "continue_routine", "craft_item", "mine_block"],
  });

  assert.equal(result.fallback, true);
  assert.match(result.fallbackReason ?? "", /timeout/);
  assert.equal(result.plan.steps.length >= 3, true);
  assert.equal(result.plan.steps[0]?.status, "active");
  assert.equal(result.plan.steps.some((step) => step.nextAction === "craft_item"), true);
});

test("decision service advertises optional skill choices in the decision prompt", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(mockProvider({
    goal: "Gather wood for tools",
    skill: "gather_wood",
    skillParams: { count: 4 },
    intent: "gather wood",
    action: "mine_block",
    parameters: { position: { x: 2, y: 64, z: 1 }, block: "oak_log" },
    confidence: 0.8,
    reasoningSummary: "Use the wood gathering skill for the multi-step goal.",
  }));

  const service = new AgentDecisionService(registry);
  const result = await service.decide({
    ...baseInput(),
    availableActions: ["idle", "continue_routine", "mine_block"],
    availableSkills: ["gather_wood: mine visible logs and search nearby"],
  });

  const prompt = result.request.messages[0]?.content ?? "";
  assert.equal(result.decision.skill, "gather_wood");
  assert.match(prompt, /AVAILABLE_SKILLS/);
  assert.match(prompt, /gather_wood/);
  assert.match(prompt, /Skill selection is optional/);
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
