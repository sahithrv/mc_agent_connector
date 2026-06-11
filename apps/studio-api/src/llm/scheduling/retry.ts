import type { LlmResult } from "../providers/types";

export interface RetryPolicyConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryOutcome<T> {
  result: LlmResult<T>;
  attempts: number;
  delaysMs: number[];
}

export async function executeWithRetry<T>(
  operation: () => Promise<LlmResult<T>>,
  config: RetryPolicyConfig = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, config.maxAttempts ?? 3);
  const delaysMs: number[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await operation();
    if (result.ok || !result.error.retryable || attempt === maxAttempts) {
      return { result, attempts: attempt, delaysMs };
    }

    const delay = retryDelay(attempt, config);
    delaysMs.push(delay);
    await (config.sleep ?? sleep)(delay);
  }

  throw new Error("retry loop exited unexpectedly");
}

function retryDelay(attempt: number, config: RetryPolicyConfig): number {
  const baseDelayMs = config.baseDelayMs ?? 250;
  const maxDelayMs = config.maxDelayMs ?? 5_000;
  const jitterRatio = config.jitterRatio ?? 0.2;
  const random = config.random ?? Math.random;
  const raw = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = raw * jitterRatio * random();
  return Math.round(raw + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
