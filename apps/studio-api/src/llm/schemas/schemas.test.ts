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
