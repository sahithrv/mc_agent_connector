import type { ZodType } from "zod";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  provider: string;
  model: string;
  system: string;
  messages: LlmMessage[];
  schemaName: string;
  temperature: number;
  timeoutMs: number;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmPromptMetadata {
  provider: string;
  model: string;
  schemaName: string;
  temperature: number;
  timeoutMs: number;
  messageCount: number;
}

export interface LlmStructuredOutputDebug<T> {
  schemaName: string;
  value: T;
  usage?: LlmUsage;
}

export type LlmResult<T> =
  | { ok: true; value: T; usage?: LlmUsage }
  | { ok: false; error: LlmError };

export interface LlmError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T>>;
}

export function llmError<T>(
  code: string,
  message: string,
  retryable = false,
): LlmResult<T> {
  return { ok: false, error: { code, message, retryable } };
}
