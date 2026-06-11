import type { ActionRequest, ActionResult } from "@mc-ai-video/contracts";

import type { UiAgentRuntime } from "../../lib/types";

export interface ProviderErrorView {
  id?: string;
  agentId?: string;
  providerRef?: string;
  message: string;
  timestamp?: string;
}

export interface RateLimitView {
  providerRef?: string;
  limited: boolean;
  remaining?: number;
  limit?: number;
  resetAt?: string;
  message?: string;
}

export interface LlmQueueSnapshot {
  activeAgentIds?: string[];
  queuedAgentIds?: string[];
  providerErrors?: ProviderErrorView[];
  rateLimits?: RateLimitView[];
  maxConcurrency?: number;
}

export interface ActionLogSnapshot {
  requests?: ActionRequest[];
  results?: ActionResult[];
}

export interface AgentQueueRow {
  agent: UiAgentRuntime;
  waitLabel: string;
}
