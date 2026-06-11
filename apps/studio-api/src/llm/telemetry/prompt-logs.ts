import { randomUUID } from "node:crypto";

import type { JsonValue } from "@mc-ai-video/contracts";

import type { AgentDecision } from "../schemas";
import type { LlmRequest, LlmUsage } from "../providers";

export type PromptLogStatus = "success" | "error" | "fallback";

export interface PromptRequestMetadata {
  provider: string;
  model: string;
  schemaName: string;
  temperature: number;
  timeoutMs: number;
  messageCount: number;
  systemChars: number;
  messageChars: number;
}

export interface PromptLogRecord {
  id: string;
  provider: string;
  model: string;
  schemaName: string;
  status: PromptLogStatus;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  usage?: LlmUsage;
  metadata: PromptRequestMetadata;
  structuredOutput?: JsonValue;
  createdAt: string;
}

export interface CreatePromptLogInput {
  id?: string;
  request: LlmRequest;
  status: PromptLogStatus;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  usage?: LlmUsage;
  structuredOutput?: JsonValue;
  createdAt?: string;
}

export interface PromptLogQuery {
  provider?: string;
  schemaName?: string;
  status?: PromptLogStatus;
  limit?: number;
}

export interface PromptLogRepository {
  create(input: CreatePromptLogInput): PromptLogRecord;
  list(query?: PromptLogQuery): PromptLogRecord[];
}

export class InMemoryPromptLogRepository implements PromptLogRepository {
  private readonly records: PromptLogRecord[] = [];

  public create(input: CreatePromptLogInput): PromptLogRecord {
    const record: PromptLogRecord = {
      id: input.id ?? randomUUID(),
      provider: input.request.provider,
      model: input.request.model,
      schemaName: input.request.schemaName,
      status: input.status,
      latencyMs: Math.max(0, input.latencyMs),
      errorCode: input.errorCode,
      errorMessage: input.errorMessage ? redactSecretLikeText(input.errorMessage) : undefined,
      usage: normalizeUsage(input.usage),
      metadata: toPromptMetadata(input.request),
      structuredOutput: input.structuredOutput,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  public list(query: PromptLogQuery = {}): PromptLogRecord[] {
    const limit = query.limit ?? 100;
    return this.records
      .filter((record) => !query.provider || record.provider === query.provider)
      .filter((record) => !query.schemaName || record.schemaName === query.schemaName)
      .filter((record) => !query.status || record.status === query.status)
      .sort(compareNewestFirst)
      .slice(0, limit);
  }
}

export function toPromptMetadata(request: LlmRequest): PromptRequestMetadata {
  return {
    provider: request.provider,
    model: request.model,
    schemaName: request.schemaName,
    temperature: request.temperature,
    timeoutMs: request.timeoutMs,
    messageCount: request.messages.length,
    systemChars: request.system.length,
    messageChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
  };
}

export function redactSecretLikeText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9._~+/=-]{8,}\b/gi, "[redacted]")
    .slice(0, 500);
}

export function normalizeUsage(usage: LlmUsage | undefined): LlmUsage | undefined {
  if (!usage) return undefined;

  const normalized: LlmUsage = {};
  if (usage.inputTokens !== undefined) normalized.inputTokens = Math.max(0, usage.inputTokens);
  if (usage.outputTokens !== undefined) normalized.outputTokens = Math.max(0, usage.outputTokens);
  return normalized.inputTokens === undefined && normalized.outputTokens === undefined
    ? undefined
    : normalized;
}

export interface DecisionLogRecord {
  id: string;
  agentId: string;
  promptLogId?: string;
  decision: AgentDecision;
  selectedAction: AgentDecision["action"];
  confidence: number;
  fallback: boolean;
  createdAt: string;
}

export interface CreateDecisionLogInput {
  id?: string;
  agentId: string;
  promptLogId?: string;
  decision: AgentDecision;
  fallback?: boolean;
  createdAt?: string;
}

export interface DecisionLogQuery {
  agentId?: string;
  fallback?: boolean;
  limit?: number;
}

export interface DecisionLogRepository {
  create(input: CreateDecisionLogInput): DecisionLogRecord;
  list(query?: DecisionLogQuery): DecisionLogRecord[];
}

export class InMemoryDecisionLogRepository implements DecisionLogRepository {
  private readonly records: DecisionLogRecord[] = [];

  public create(input: CreateDecisionLogInput): DecisionLogRecord {
    const record: DecisionLogRecord = {
      id: input.id ?? randomUUID(),
      agentId: input.agentId,
      promptLogId: input.promptLogId,
      decision: input.decision,
      selectedAction: input.decision.action,
      confidence: input.decision.confidence,
      fallback: input.fallback ?? false,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  public list(query: DecisionLogQuery = {}): DecisionLogRecord[] {
    const limit = query.limit ?? 100;
    return this.records
      .filter((record) => !query.agentId || record.agentId === query.agentId)
      .filter((record) => query.fallback === undefined || record.fallback === query.fallback)
      .sort(compareNewestFirst)
      .slice(0, limit);
  }
}

function compareNewestFirst(left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}
