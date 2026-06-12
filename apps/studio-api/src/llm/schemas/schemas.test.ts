import assert from "node:assert/strict";
import test from "node:test";

import { AgentDecisionSchema, AiChatMessageProposalSchema, ReflectionResultSchema } from "./index";
import { validateStructuredOutput } from "./validation";

test("invalid structured output is rejected by validation utility", () => {
  const result = validateStructuredOutput("AgentDecision", AgentDecisionSchema, {
    intent: "bad",
    action: "idle",
    parameters: {},
    confidence: 2,
    reasoningSummary: "too confident",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "schema_validation_failed");
    assert.equal(result.error.retryable, false);
  }
});

test("AgentDecision rejects unknown actions", () => {
  const result = AgentDecisionSchema.safeParse({
    intent: "celebrate",
    action: "dance",
    parameters: {},
    confidence: 0.5,
    reasoningSummary: "Wanted a non-existent action.",
  });

  assert.equal(result.success, false);
});

test("AgentDecision normalizes common private speech variants", () => {
  const result = AgentDecisionSchema.parse({
    intent: "follow leader",
    action: "follow_player",
    parameters: { username: "JunoBot", range: 2 },
    speech: {
      visibility: "ai only",
      text: "Following Juno to build site.",
    },
    confidence: 0.9,
    reasoningSummary: "Task says follow leader.",
  });

  assert.equal(result.speech?.visibility, "ai");
  assert.equal(result.speech?.content, "Following Juno to build site.");
});

test("AgentDecision normalizes boolean public speech shape", () => {
  const result = AgentDecisionSchema.parse({
    intent: "follow leader",
    action: "follow_player",
    parameters: { username: "QuinBot", range: 5 },
    speech: {
      public: false,
      message: "Following leader to build site.",
    },
    confidence: 0.9,
    reasoningSummary: "Task says follow leader.",
  });

  assert.equal(result.speech?.visibility, "ai");
  assert.equal(result.speech?.content, "Following leader to build site.");
});

test("AgentDecision normalizes DeepSeek-style wrapped speech aliases", () => {
  const result = AgentDecisionSchema.parse({
    result: {
      intent: "coordinate privately",
      action: "chat_ai_private",
      params: { topic: "site_claim" },
      speech: {
        public: false,
        message: "Claiming the site now.",
        recipients: ["leader"],
      },
      confidence: 0.74,
      reasoning_summary: "Use private team speech for coordination.",
    },
  });

  assert.deepEqual(result.parameters, { topic: "site_claim" });
  assert.equal(result.reasoningSummary, "Use private team speech for coordination.");
  assert.equal(result.speech?.visibility, "ai");
  assert.equal(result.speech?.content, "Claiming the site now.");
  assert.deepEqual(result.speech?.recipientIds, ["leader"]);
});

test("ReflectionResult clamps relationship values to 0-100", () => {
  const result = ReflectionResultSchema.parse({
    emotionalState: "alarmed",
    relationships: [{
      targetId: "leader",
      trust: -25,
      loyalty: 130,
      fear: 101,
      tags: ["attacked_me"],
    }],
    newGoals: ["warn farmer team"],
    memorySummary: "Leader attacked me during harvest.",
    reasoningSummary: "Major betrayal changed my stance.",
  });

  assert.equal(result.relationships[0]?.trust, 0);
  assert.equal(result.relationships[0]?.loyalty, 100);
  assert.equal(result.relationships[0]?.fear, 100);
});

test("chat schema rejects empty content and invalid recipients", () => {
  const empty = AiChatMessageProposalSchema.safeParse({
    senderId: "farmer",
    recipientIds: ["leader"],
    visibility: "ai",
    content: " ",
  });
  assert.equal(empty.success, false);

  const invalidRecipients = AiChatMessageProposalSchema.safeParse({
    senderId: "farmer",
    recipientIds: [],
    visibility: "ai",
    content: "help",
  });
  assert.equal(invalidRecipients.success, false);
});
