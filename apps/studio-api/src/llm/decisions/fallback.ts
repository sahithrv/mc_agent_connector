import type { AgentConfig, AiChatMessage, GameEvent, JsonValue } from "@mc-ai-video/contracts";

import type { PromptPerceptionSnapshot } from "../prompts";
import { AgentDecisionSchema, type AgentDecision } from "../schemas/agent-decision";
import { allowedDecisionActionsForAgent } from "./intent-map";

export interface FallbackDecisionInput {
  agent: Pick<AgentConfig, "id" | "name" | "team" | "routine" | "allowedActions">;
  reason: string;
  perception?: PromptPerceptionSnapshot;
  dynamicState?: {
    health?: number;
    currentRoutine?: string;
    threatLevel?: "none" | "low" | "medium" | "high";
  };
  recentChat?: AiChatMessage[];
  recentEvents?: GameEvent[];
  availableActions?: AgentDecision["action"][];
}

export function fallbackDecision(input: FallbackDecisionInput): AgentDecision {
  const availableActions = input.availableActions ?? allowedDecisionActionsForAgent(input.agent);
  const reason = compactReason(input.reason);

  if (isThreatened(input) && availableActions.includes("flee")) {
    const fleeParams = fleeParameters(input, reason);
    if (!fleeParams) {
      return helpOrContinueFallback(input, availableActions, reason);
    }
    return parseFallback({
      intent: "retreat",
      action: "flee",
      parameters: fleeParams,
      confidence: 0.4,
      reasoningSummary: `Fallback flee: ${reason}`,
    });
  }

  return helpOrContinueFallback(input, availableActions, reason);
}

function helpOrContinueFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision {
  if (shouldAskForHelp(input) && availableActions.includes("chat_ai_private")) {
    const recipientIds = helpRecipients(input);
    if (recipientIds.length > 0) {
      return parseFallback({
        intent: "ask_for_help",
        action: "chat_ai_private",
        parameters: {
          recipientIds,
          message: `I need help: ${reason}`,
          topic: "fallback_help",
        },
        speech: {
          visibility: "ai",
          recipientIds,
          topic: "fallback_help",
          content: `I need help: ${reason}`,
        },
        confidence: 0.35,
        reasoningSummary: `Fallback ask for help: ${reason}`,
      });
    }
  }

  if (shouldAskForHelp(input) && availableActions.includes("chat_public")) {
    return parseFallback({
      intent: "ask_for_help",
      action: "chat_public",
      parameters: { message: `I need help: ${reason}` },
      speech: {
        visibility: "public",
        content: `I need help: ${reason}`,
      },
      confidence: 0.3,
      reasoningSummary: `Fallback public help request: ${reason}`,
    });
  }

  if ((input.dynamicState?.currentRoutine || input.agent.routine) && availableActions.includes("continue_routine")) {
    const routineId = input.dynamicState?.currentRoutine ?? input.agent.routine ?? "routine";
    return parseFallback({
      intent: "continue_work",
      action: "continue_routine",
      parameters: { routineId, fallback: true, reason },
      confidence: 0.45,
      reasoningSummary: `Fallback continue routine: ${reason}`,
    });
  }

  return parseFallback({
    intent: "wait",
    action: "idle",
    parameters: { durationMs: 1_000, fallback: true, reason },
    confidence: 0.5,
    reasoningSummary: `Fallback idle: ${reason}`,
  });
}

function parseFallback(decision: AgentDecision): AgentDecision {
  // Schema fallback guard: every fallback must remain a valid provider-shaped decision.
  return AgentDecisionSchema.parse(decision);
}

function isThreatened(input: FallbackDecisionInput): boolean {
  if ((input.dynamicState?.health ?? 20) <= 8 || input.dynamicState?.threatLevel === "high") {
    return true;
  }
  return hasThreat(input.perception?.nearbyPlayers) || hasThreat(input.perception?.nearbyEntities);
}

function shouldAskForHelp(input: FallbackDecisionInput): boolean {
  return isThreatened(input)
    || (input.recentEvents ?? []).some((event) => event.severity >= 4 || event.targetId === input.agent.id)
    || (input.recentChat ?? []).some((message) => message.recipientIds.includes(input.agent.id));
}

function hasThreat(values: unknown): boolean {
  if (!Array.isArray(values)) {
    return false;
  }
  return values.some((value) => {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value as Record<string, JsonValue | undefined>;
    return record.hostile === true || record.threatening === true;
  });
}

function fleeParameters(input: FallbackDecisionInput, reason: string): Record<string, JsonValue> | undefined {
  const threat = firstThreat(input.perception?.nearbyEntities) ?? firstThreat(input.perception?.nearbyPlayers);
  if (!threat) {
    return undefined;
  }

  const position = positionValue(threat.position);
  const entityId = stringValue(threat.id);
  const username = stringValue(threat.username) ?? stringValue(threat.name);
  const target: Record<string, JsonValue> = {
    distance: 16,
    fallback: true,
    reason,
  };
  if (entityId) target.entityId = entityId;
  if (username) target.username = username;
  if (position) target.position = position;
  return entityId || username || position ? target : undefined;
}

function firstThreat(values: unknown): Record<string, JsonValue | undefined> | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  return values.find((value): value is Record<string, JsonValue | undefined> =>
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && ((value as Record<string, JsonValue | undefined>).hostile === true
      || (value as Record<string, JsonValue | undefined>).threatening === true),
  );
}

function helpRecipients(input: FallbackDecisionInput): string[] {
  const direct = (input.recentChat ?? [])
    .flatMap((message) => [message.senderId, ...message.recipientIds])
    .filter((id) => id && id !== input.agent.id);
  const players = (input.perception?.nearbyPlayers ?? [])
    .map((player) => typeof player.id === "string" ? player.id : undefined)
    .filter((id): id is string => Boolean(id && id !== input.agent.id));
  return [...new Set([...direct, ...players])].slice(0, 5);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function positionValue(value: unknown): JsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number"
    && typeof record.y === "number"
    && typeof record.z === "number"
    ? {
        x: record.x,
        y: record.y,
        z: record.z,
        ...(typeof record.world === "string" ? { world: record.world } : {}),
      }
    : undefined;
}

function compactReason(reason: string): string {
  const trimmed = reason.trim() || "LLM decision unavailable";
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}
