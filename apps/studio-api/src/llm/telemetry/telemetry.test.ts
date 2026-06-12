import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDecision } from "../schemas";
import type { LlmRequest } from "../providers";
import {
  InMemoryDecisionLogRepository,
  InMemoryPromptLogRepository,
  InMemoryTokenCostTelemetryRepository,
} from "./index";

test("prompt logs store metadata without prompt text or secrets", () => {
  const prompts = new InMemoryPromptLogRepository();
  const record = prompts.create({
    request: request(),
    status: "error",
    latencyMs: 52,
    errorCode: "provider_error",
    errorMessage: "failed with Bearer sk-testsecret1234567890",
  });

  assert.equal(record.provider, "openai");
  assert.equal(record.model, "gpt-test");
  assert.equal(record.schemaName, "AgentDecision");
  assert.equal(record.metadata.systemChars, 21);
  assert.equal(record.metadata.messageCount, 1);
  assert.equal(JSON.stringify(record).includes("secret mission"), false);
  assert.equal(record.errorMessage?.includes("sk-testsecret"), false);
});

test("decision logs expose selected action, confidence, and fallback for dashboards", () => {
  const decisions = new InMemoryDecisionLogRepository();
  decisions.create({
    agentId: "farmer",
    promptLogId: "prompt-one",
    decision: decision("idle", 0.4),
    fallback: true,
    createdAt: "2026-06-10T21:00:00.000Z",
  });
  decisions.create({
    agentId: "farmer",
    decision: decision("chat_ai_private", 0.8),
    createdAt: "2026-06-10T21:01:00.000Z",
  });

  const listed = decisions.list({ agentId: "farmer" });
  assert.deepEqual(listed.map((item) => item.selectedAction), ["chat_ai_private", "idle"]);
  assert.equal(listed[0]?.confidence, 0.8);
  assert.equal(decisions.list({ fallback: true })[0]?.promptLogId, "prompt-one");
});

test("token telemetry records usage when present and ignores missing usage", () => {
  const telemetry = new InMemoryTokenCostTelemetryRepository();

  assert.equal(telemetry.record({
    provider: "openai",
    model: "gpt-test",
  }), undefined);

  const record = telemetry.record({
    provider: "openai",
    model: "gpt-test",
    usage: { inputTokens: 100, outputTokens: 20, cacheHitInputTokens: 80, cacheMissInputTokens: 20 },
    rate: { inputUsdPer1k: 0.01, outputUsdPer1k: 0.02 },
  });

  assert.equal(record?.totalTokens, 120);
  assert.equal(record?.cacheHitInputTokens, 80);
  assert.equal(record?.cacheMissInputTokens, 20);
  assert.equal(record?.estimatedCostUsd, 0.0014);
});

function request(): LlmRequest {
  return {
    provider: "openai",
    model: "gpt-test",
    system: "Keep secrets private.",
    messages: [{ role: "user", content: "secret mission details" }],
    schemaName: "AgentDecision",
    temperature: 0.2,
    timeoutMs: 1000,
  };
}

function decision(action: AgentDecision["action"], confidence: number): AgentDecision {
  return {
    intent: "wait",
    action,
    parameters: {},
    confidence,
    reasoningSummary: "No urgent stimulus.",
  };
}
