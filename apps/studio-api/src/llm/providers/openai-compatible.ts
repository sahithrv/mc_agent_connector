import type { ZodType } from "zod";

import { parseJsonObject, validateStructuredOutput } from "../schemas/validation";
import { llmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export interface OpenAiCompatibleProviderConfig {
  apiKey?: string;
  baseUrl: string;
  defaultModel?: string;
  providerName: string;
}

export interface OpenAiCompatibleChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  response_format: { type: "json_object" };
}

export interface OpenAiCompatibleChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiCompatibleChatClient {
  createChatCompletion(
    body: OpenAiCompatibleChatRequest,
    options: { apiKey: string; baseUrl: string; timeoutMs: number },
  ): Promise<OpenAiCompatibleChatResponse>;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  public readonly name: string;

  public constructor(
    private readonly config: OpenAiCompatibleProviderConfig,
    private readonly client: OpenAiCompatibleChatClient = new FetchOpenAiCompatibleChatClient(),
  ) {
    this.name = config.providerName;
  }

  public async generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T>> {
    if (!this.config.apiKey) {
      return llmError("provider_config_missing", `${this.name} API key is not configured`, false);
    }

    try {
      const response = await this.client.createChatCompletion(this.toBody(request), {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        timeoutMs: request.timeoutMs,
      });
      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return llmError("provider_empty_output", `${this.name} returned no structured content`, true);
      }
      return validateStructuredOutput(request.schemaName, schema, parseJsonObject(content), {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
      });
    } catch (error) {
      return llmError("provider_request_failed", formatProviderError(error), isRetryableError(error));
    }
  }

  private toBody(request: LlmRequest): OpenAiCompatibleChatRequest {
    return {
      model: request.model || this.config.defaultModel || "",
      messages: [
        { role: "system", content: request.system },
        ...request.messages,
      ],
      temperature: request.temperature,
      response_format: { type: "json_object" },
    };
  }
}

export class FetchOpenAiCompatibleChatClient implements OpenAiCompatibleChatClient {
  public async createChatCompletion(
    body: OpenAiCompatibleChatRequest,
    options: { apiKey: string; baseUrl: string; timeoutMs: number },
  ): Promise<OpenAiCompatibleChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`${trimSlash(options.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
      return await response.json() as OpenAiCompatibleChatResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function formatProviderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /HTTP 5\d\d/.test(error.message));
}
