import type {
  ActionRequest,
  ActionResult,
  ActionRiskLevel,
  AgentConfig,
  AiChatMessage,
  EventSeverity,
  Visibility,
} from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";

export interface AiChatPublishInput {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility: Visibility;
  content: string;
}

export interface AiChatBus {
  publish(message: AiChatPublishInput): Promise<AiChatMessage> | AiChatMessage;
}

export interface ActionPolicy {
  maxIdleMs?: number;
  publicChatMaxLength?: number;
  aiChatMaxLength?: number;
  chatCooldownMs?: number;
  maxMoveDistance?: number;
  maxCollectDistance?: number;
  maxMineDistance?: number;
  protectedPlayerUsernames?: string[];
  playerTeams?: Record<string, string>;
  allowedAttackEntityNames?: string[];
  allowDirectorAttackOverride?: boolean;
}

export interface ActionRuntimeContext {
  agent: AgentConfig;
  bot?: BotHandle;
  chatBus?: AiChatBus;
  policy?: ActionPolicy;
}

export interface ActionRunContext extends ActionRuntimeContext {
  request: ActionRequest;
  signal: AbortSignal;
  startedAt: string;
}

export type CanRunResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface RegisteredAction {
  name: string;
  risk: ActionRiskLevel;
  timeoutMs: number;
  canRun(context: ActionRuntimeContext, request: ActionRequest): CanRunResult;
  run(context: ActionRunContext): Promise<ActionResult>;
}
