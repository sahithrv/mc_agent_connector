import { randomUUID } from "node:crypto";

import type { LlmUsage } from "../providers";

export interface TokenCostRate {
  inputUsdPer1k: number;
  outputUsdPer1k: number;
}

export interface TokenCostRecord {
  id: string;
  promptLogId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  createdAt: string;
}

export interface RecordTokenCostInput {
  id?: string;
  promptLogId?: string;
  provider: string;
  model: string;
  usage?: LlmUsage;
  rate?: TokenCostRate;
  createdAt?: string;
}

export interface TokenCostTelemetryRepository {
  record(input: RecordTokenCostInput): TokenCostRecord | undefined;
  list(limit?: number): TokenCostRecord[];
}

export class InMemoryTokenCostTelemetryRepository implements TokenCostTelemetryRepository {
  private readonly records: TokenCostRecord[] = [];

  public record(input: RecordTokenCostInput): TokenCostRecord | undefined {
    const inputTokens = input.usage?.inputTokens ?? 0;
    const outputTokens = input.usage?.outputTokens ?? 0;
    if (!input.usage || (inputTokens === 0 && outputTokens === 0)) {
      return undefined;
    }

    const record: TokenCostRecord = {
      id: input.id ?? randomUUID(),
      promptLogId: input.promptLogId,
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: input.rate
        ? (inputTokens / 1000) * input.rate.inputUsdPer1k
          + (outputTokens / 1000) * input.rate.outputUsdPer1k
        : undefined,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  public list(limit = 100): TokenCostRecord[] {
    return [...this.records]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, limit);
  }
}
