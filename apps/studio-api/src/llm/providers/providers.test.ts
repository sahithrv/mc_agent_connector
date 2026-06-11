import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { AgentDecisionSchema } from "../schemas";
import { AnthropicProvider, type AnthropicMessagesClient, type AnthropicMessagesRequest } from "./anthropic";
import { createDeepSeekProvider } from "./deepseek";
import { createOpenAiProvider } from "./openai";
import type {
  OpenAiCompatibleChatClient,
  OpenAiCompatibleChatRequest,
} from "./openai-compatible";
import { LlmProviderRegistry } from "./registry";
import { UnsupportedLlmProvider } from "./unsupported";
import type { LlmProvider, LlmRequest } from "./types";

test("providers can be mocked and unknown provider returns typed error", async () => {
  const registry = new LlmProviderRegistry();
  const mockProvider: LlmProvider = {
    name: "mock",
    async generateStructured(_request, schema) {
      return { ok: true, value: schema.parse({ value: "ok" }) };
    },
  };

  registry.register(mockProvider);
  assert.deepEqual(
    await registry.generateStructured({ ...request(), provider: "mock" }, z.object({ value: z.literal("ok") })),
    { ok: true, value: { value: "ok" } },
  );

  const unknown = await registry.generateStructured(request(), z.object({}));
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.error.code, "unknown_provider");
    assert.equal(unknown.error.retryable, false);
  }
});

test("missing key fails only when the selected provider is used", async () => {
  const registry = new LlmProviderRegistry();
  registry.register(createOpenAiProvider({}));
  registry.register(new UnsupportedLlmProvider("local", "not implemented"));

  const local = await registry.generateStructured({ ...request(), provider: "local" }, z.object({}));
  assert.equal(local.ok, false);
  if (!local.ok) assert.equal(local.error.code, "provider_unsupported");

  const openai = await registry.generateStructured({ ...request(), provider: "openai" }, z.object({}));
  assert.equal(openai.ok, false);
  if (!openai.ok) assert.equal(openai.error.code, "provider_config_missing");
});

test("OpenAI adapter maps structured chat completion request", async () => {
  const captures: OpenAiCompatibleChatRequest[] = [];
  const client: OpenAiCompatibleChatClient = {
    async createChatCompletion(body, options) {
      captures.push(body);
      assert.equal(options.baseUrl, "https://openai.test/v1");
      assert.equal(options.apiKey, "openai-key");
      return {
        choices: [{ message: { content: JSON.stringify(decisionOutput()) } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      };
    },
  };

  const result = await createOpenAiProvider({
    apiKey: "openai-key",
    baseUrl: "https://openai.test/v1",
  }, client).generateStructured(request("openai"), AgentDecisionSchema);

  assert.equal(result.ok, true);
  assert.equal(captures[0]?.model, "gpt-test");
  assert.deepEqual(captures[0]?.messages.map((message) => message.role), ["system", "user"]);
  assert.deepEqual(captures[0]?.response_format, { type: "json_object" });
  if (result.ok) assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 4 });
});

test("Anthropic adapter maps messages request", async () => {
  const captures: AnthropicMessagesRequest[] = [];
  const client: AnthropicMessagesClient = {
    async createMessage(body, options) {
      captures.push(body);
      assert.equal(options.baseUrl, "https://anthropic.test/v1");
      assert.equal(options.apiKey, "anthropic-key");
      return {
        content: [{ type: "text", text: JSON.stringify(decisionOutput()) }],
        usage: { input_tokens: 8, output_tokens: 5 },
      };
    },
  };

  const result = await new AnthropicProvider({
    apiKey: "anthropic-key",
    baseUrl: "https://anthropic.test/v1",
  }, client).generateStructured(request("anthropic"), AgentDecisionSchema);

  assert.equal(result.ok, true);
  assert.equal(captures[0]?.model, "gpt-test");
  assert.equal(captures[0]?.system, "Return compact JSON.");
  assert.deepEqual(captures[0]?.messages, [{ role: "user", content: "decide" }]);
  assert.equal(captures[0]?.max_tokens, 1024);
});

test("DeepSeek adapter uses OpenAI-compatible mapping and configurable base URL", async () => {
  let captured: OpenAiCompatibleChatRequest | undefined;
  const client: OpenAiCompatibleChatClient = {
    async createChatCompletion(body, options) {
      captured = body;
      assert.equal(options.baseUrl, "https://deepseek.test");
      return { choices: [{ message: { content: JSON.stringify(decisionOutput()) } }] };
    },
  };

  const result = await createDeepSeekProvider({
    apiKey: "deepseek-key",
    baseUrl: "https://deepseek.test",
    defaultModel: "deepseek-chat",
  }, client).generateStructured({ ...request("deepseek"), model: "" }, AgentDecisionSchema);

  assert.equal(result.ok, true);
  assert.equal(captured?.model, "deepseek-chat");
  assert.equal(captured?.messages[0]?.role, "system");
});

function request(provider = "missing"): LlmRequest {
  return {
    provider,
    model: "gpt-test",
    system: "Return compact JSON.",
    messages: [{ role: "user", content: "decide" }],
    schemaName: "AgentDecision",
    temperature: 0.2,
    timeoutMs: 1000,
  };
}

function decisionOutput() {
  return {
    intent: "wait",
    action: "idle",
    parameters: { durationMs: 1000 },
    confidence: 0.8,
    reasoningSummary: "No urgent stimulus.",
  };
}
