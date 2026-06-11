import type { ZodType } from "zod";

import { llmError, type LlmProvider, type LlmRequest, type LlmResult } from "../providers/types";

export type MockLlmResolver = (request: LlmRequest, callIndex: number) => unknown;

export class DeterministicMockLlmProvider implements LlmProvider {
  public readonly name = "mock";
  public readonly requests: LlmRequest[] = [];
  private callCount = 0;

  public constructor(private readonly resolver: MockLlmResolver) {}

  public async generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T>> {
    this.requests.push(request);
    this.callCount += 1;
    const value = this.resolver(request, this.callCount);
    if (value instanceof Error) {
      const retryable = (value as Error & { retryable?: boolean }).retryable ?? true;
      return llmError(value.name || "mock_error", value.message, retryable);
    }
    return {
      ok: true,
      value: schema.parse(value),
      usage: { inputTokens: 42, outputTokens: 16 },
    };
  }
}

export function mockLlmProviderError(code: string, message: string, retryable = true): Error {
  const error = new Error(message);
  error.name = code;
  Object.defineProperty(error, "retryable", { value: retryable });
  return error;
}
