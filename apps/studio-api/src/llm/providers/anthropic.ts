import type { ZodType } from "zod";

import { parseJsonObject, validateStructuredOutput } from "../schemas/validation";
import { llmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";
import type { ProviderEndpointConfig } from "./config";

export interface AnthropicMessagesRequest {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature: number;
  max_tokens: number;
}

export interface AnthropicMessagesResponse {
  content?: Array<{ type: "text"; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicMessagesClient {
  createMessage(
    body: AnthropicMessagesRequest,
    options: { apiKey: string; baseUrl: string; timeoutMs: number },
  ): Promise<AnthropicMessagesResponse>;
}

export class AnthropicProvider implements LlmProvider {
  public readonly name = "anthropic";

  public constructor(
    private readonly config: ProviderEndpointConfig,
    private readonly client: AnthropicMessagesClient = new FetchAnthropicMessagesClient(),
  ) {}

  public async generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T>> {
    if (!this.config.apiKey) {
      return llmError("provider_config_missing", "anthropic API key is not configured", false);
    }

    try {
      const response = await this.client.createMessage(this.toBody(request), {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? "https://api.anthropic.com/v1",
        timeoutMs: request.timeoutMs,
      });
      const content = response.content?.find((item) => item.type === "text")?.text;
      if (!content) {
        return llmError("provider_empty_output", "anthropic returned no structured content", true);
      }
      return validateStructuredOutput(request.schemaName, schema, parseJsonObject(content), {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      });
    } catch (error) {
      return llmError("provider_request_failed", formatProviderError(error), isRetryableError(error));
    }
  }

  private toBody(request: LlmRequest): AnthropicMessagesRequest {
    return {
      model: request.model || this.config.defaultModel || "",
      system: request.system,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: 1024,
    };
  }
}

export class FetchAnthropicMessagesClient implements AnthropicMessagesClient {
  public async createMessage(
    body: AnthropicMessagesRequest,
    options: { apiKey: string; baseUrl: string; timeoutMs: number },
  ): Promise<AnthropicMessagesResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`${trimSlash(options.baseUrl)}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
      return await response.json() as AnthropicMessagesResponse;
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
