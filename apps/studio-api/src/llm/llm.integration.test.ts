import assert from "node:assert/strict";
import test from "node:test";

import type { RelationshipRecord } from "../db";
import {
  expectedLeaderAttackReflectionOutput,
  expectedPrivateWarningChatOutput,
  expectedWarningDecisionOutput,
  sampleChatContext,
  sampleLeaderAttackEvent,
  sampleMemoryContext,
  samplePerceptionContext,
  sampleRelationshipContext,
} from "./fixtures/prompt-review";
import { LlmProviderRegistry } from "./providers";
import type { LlmRequest } from "./providers/types";
import { buildPromptContext } from "./prompts";
import { AgentDecisionService } from "./decisions";
import {
  applyRelationshipUpdates,
  InMemoryRelationshipAuditRepository,
  type RelationshipStore,
} from "./reflection";
import {
  AgentDecisionActionSchema,
  AgentDecisionSchema,
  AiChatMessageProposalSchema,
  ReflectionResultSchema,
} from "./schemas";
import { DeterministicMockLlmProvider } from "./testing/mock-provider";

test("mocked leader attack drops farmer loyalty and emits warning chat", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(new DeterministicMockLlmProvider((request) => {
    if (request.schemaName === "ReflectionResult") return expectedLeaderAttackReflectionOutput;
    if (request.schemaName === "AgentDecision") return expectedWarningDecisionOutput;
    throw new Error(`unexpected schema: ${request.schemaName}`);
  }));

  const reflectionResult = await registry.generateStructured(
    reflectionRequest(),
    ReflectionResultSchema,
  );
  assert.equal(reflectionResult.ok, true);
  if (!reflectionResult.ok) throw new Error("reflection mock failed");

  const store = new MemoryRelationshipStore([{
    agentId: "farmer-1",
    targetId: "leader-1",
    trust: 38,
    loyalty: 72,
    fear: 22,
    tags: ["leader", "recently_aggressive"],
  }]);
  const audit = new InMemoryRelationshipAuditRepository();
  const leaderReflection = reflectionResult.value.relationships[0];
  assert.ok(leaderReflection);

  const updated = applyRelationshipUpdates({
    agentId: "farmer-1",
    store,
    audit,
    reason: "leader-attack-reflection",
    eventId: sampleLeaderAttackEvent.id,
    createdAt: sampleLeaderAttackEvent.timestamp,
    updates: [{
      targetId: leaderReflection.targetId,
      trustDelta: leaderReflection.trust - 38,
      loyaltyDelta: leaderReflection.loyalty - 72,
      fearDelta: leaderReflection.fear - 22,
      emotionalState: reflectionResult.value.emotionalState,
      addTags: leaderReflection.tags,
    }],
  });

  assert.equal(updated[0]?.targetId, "leader-1");
  assert.equal(updated[0]?.loyalty, 24);
  assert.ok((updated[0]?.loyalty ?? 100) < 72);
  assert.equal(audit.listForAgent("farmer-1")[0]?.eventId, sampleLeaderAttackEvent.id);

  const decisionService = new AgentDecisionService(registry);
  const decision = await decisionService.decide({
    agent: farmerAgent(),
    model: { provider: "mock", model: "mock-v1", timeoutMs: 1_000 },
    staticPersona: {
      identity: "Mira is a careful farmer who protects the village food supply.",
      speakingStyle: "direct and brief",
      values: ["team safety", "honest warnings"],
    },
    dynamicState: {
      health: 12,
      currentRoutine: "farm",
      emotionalState: reflectionResult.value.emotionalState,
      threatLevel: "high",
    },
    perception: samplePerceptionContext,
    relationships: [{
      agentId: "leader-1",
      name: "LeaderBot",
      trust: updated[0]?.trust,
      loyalty: updated[0]?.loyalty,
      fear: updated[0]?.fear,
      tags: updated[0]?.tags,
    }],
    memories: sampleMemoryContext,
    recentChat: sampleChatContext,
    recentEvents: [sampleLeaderAttackEvent],
    availableActions: ["idle", "continue_routine", "chat_ai_private", "flee"],
    constraints: ["Warn allies when attacked by a leader.", "Do not expose hidden reasoning."],
  });

  assert.equal(decision.fallback, false);
  assert.equal(decision.decision.action, "chat_ai_private");
  assert.deepEqual(decision.decision.speech, expectedWarningDecisionOutput.speech);

  const chat = AiChatMessageProposalSchema.parse({
    senderId: "farmer-1",
    recipientIds: decision.decision.speech?.recipientIds,
    visibility: decision.decision.speech?.visibility,
    content: decision.decision.speech?.content,
    topic: decision.decision.speech?.topic,
    urgency: 5,
  });
  assert.deepEqual(chat, expectedPrivateWarningChatOutput);
});

test("prompt review fixtures validate current schemas and compact context", () => {
  assert.deepEqual(AgentDecisionSchema.parse(expectedWarningDecisionOutput), expectedWarningDecisionOutput);
  assert.deepEqual(
    ReflectionResultSchema.parse(expectedLeaderAttackReflectionOutput),
    expectedLeaderAttackReflectionOutput,
  );
  assert.deepEqual(
    AiChatMessageProposalSchema.parse(expectedPrivateWarningChatOutput),
    expectedPrivateWarningChatOutput,
  );

  const context = buildPromptContext({
    agent: farmerAgent(),
    staticPersona: { identity: "Mira is a practical farmer.", speakingStyle: "brief" },
    dynamicState: { health: 12, currentRoutine: "farm", threatLevel: "high" },
    perception: samplePerceptionContext,
    relationships: sampleRelationshipContext,
    memories: sampleMemoryContext,
    recentChat: sampleChatContext,
    recentEvents: [sampleLeaderAttackEvent],
    maxChars: 2_000,
  });

  assert.equal(context.truncated, false);
  assert.match(context.contextText, /PERCEPTION/);
  assert.match(context.contextText, /LeaderBot/);
  assert.match(context.contextText, /Leader promised farmers/);
  assert.match(context.contextText, /Ping me if anyone swings/);
});

test("provider contract and LLM schemas are frozen for V1 integration", () => {
  const request: LlmRequest = reflectionRequest();
  assert.deepEqual(Object.keys(request).sort(), [
    "messages",
    "model",
    "provider",
    "schemaName",
    "system",
    "temperature",
    "timeoutMs",
  ]);
  assert.deepEqual(Object.keys(request.messages[0] ?? {}).sort(), ["content", "role"]);
  assert.deepEqual(AgentDecisionActionSchema.options, [
    "idle",
    "continue_routine",
    "chat_public",
    "chat_ai_private",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "mine_block",
    "craft_item",
    "place_block",
    "attack_entity",
  ]);
  assert.equal(AgentDecisionSchema.safeParse(expectedWarningDecisionOutput).success, true);
  assert.equal(ReflectionResultSchema.safeParse(expectedLeaderAttackReflectionOutput).success, true);
  assert.equal(AiChatMessageProposalSchema.safeParse(expectedPrivateWarningChatOutput).success, true);
});

function reflectionRequest(): LlmRequest {
  return {
    provider: "mock",
    model: "mock-v1",
    system: "Return compact JSON. Never include chain-of-thought.",
    messages: [{
      role: "user",
      content: `Reflect on event ${sampleLeaderAttackEvent.id}.`,
    }],
    schemaName: "ReflectionResult",
    temperature: 0.2,
    timeoutMs: 1_000,
  };
}

function farmerAgent() {
  return {
    id: "farmer-1",
    name: "Mira",
    role: "farmer",
    team: "village",
    routine: "farm",
    allowedActions: ["idle", "continue_routine", "chat_ai_private", "flee"],
  };
}

class MemoryRelationshipStore implements RelationshipStore {
  private readonly records = new Map<string, RelationshipRecord>();

  public constructor(records: RelationshipRecord[]) {
    for (const record of records) this.records.set(this.key(record.agentId, record.targetId), record);
  }

  public get(agentId: string, targetId: string): RelationshipRecord | undefined {
    return this.records.get(this.key(agentId, targetId));
  }

  public upsert(input: RelationshipRecord): RelationshipRecord {
    this.records.set(this.key(input.agentId, input.targetId), input);
    return input;
  }

  private key(agentId: string, targetId: string): string {
    return `${agentId}:${targetId}`;
  }
}
