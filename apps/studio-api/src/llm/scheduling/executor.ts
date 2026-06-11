import type { ZodType } from "zod";

import {
  llmError,
  type LlmError,
  type LlmRequest,
  type LlmResult,
} from "../providers/types";
import { executeWithRetry, type RetryPolicyConfig } from "./retry";
import { withRequestTimeout } from "./timeout";

export interface LlmStructuredTransport {
  generateStructured<T>(request: LlmRequest, schema: ZodType<T>): Promise<LlmResult<T>>;
}

export type LlmFallback<T> = (error: LlmError) => LlmResult<T> | T | Promise<LlmResult<T> | T>;

export interface ScheduledLlmExecution<T> {
  result: LlmResult<T>;
  attempts: number;
  timedOut: boolean;
  fallbackUsed: boolean;
}

export class ScheduledLlmExecutor {
  public constructor(
    private readonly transport: LlmStructuredTransport,
    private readonly retry: RetryPolicyConfig = {},
  ) {}

  public async generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
    fallback: LlmFallback<T>,
  ): Promise<ScheduledLlmExecution<T>> {
    const timeoutError: LlmError = {
      code: "llm_request_timeout",
      message: `LLM request timed out after ${request.timeoutMs}ms`,
      retryable: true,
    };

    const outcome = await withRequestTimeout(
      async () => {
        try {
          const retryOutcome = await executeWithRetry(
            async () => {
              try {
                return await this.transport.generateStructured(request, schema);
              } catch (error) {
                return llmError<T>("provider_exception", formatError(error), true);
              }
            },
            this.retry,
          );
          return {
            result: retryOutcome.result,
            attempts: retryOutcome.attempts,
            fallbackUsed: false,
          };
        } catch (error) {
          return {
            result: llmError<T>("llm_scheduler_error", formatError(error), true),
            attempts: 1,
            fallbackUsed: false,
          };
        }
      },
      request.timeoutMs,
      async () => ({
        result: normalizeFallback(await fallback(timeoutError)),
        attempts: 1,
        fallbackUsed: true,
      }),
    );

    return { ...outcome.value, timedOut: outcome.timedOut };
  }
}

function normalizeFallback<T>(value: LlmResult<T> | T): LlmResult<T> {
  if (isLlmResult(value)) return value;
  return { ok: true, value };
}

function isLlmResult<T>(value: LlmResult<T> | T): value is LlmResult<T> {
  return typeof value === "object" && value !== null && "ok" in value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
