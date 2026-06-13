import type { GameEvent } from "@mc-ai-video/contracts";

export type MemoryWriteKind =
  | "important_event"
  | "promise"
  | "betrayal"
  | "discovery"
  | "role_change"
  | "help_request"
  | "cooperation"
  | "conflict";

export interface MemoryWriteDraft {
  agentId: string;
  kind: MemoryWriteKind;
  summary: string;
  eventId?: string;
  importance: 3 | 4 | 5;
}

export interface EvaluateMemoryWriteInput {
  agentId: string;
  event: Pick<GameEvent, "id" | "type" | "severity" | "actorId" | "targetId" | "payload">;
  summary?: string;
}

export function evaluateMemoryWritePolicy(input: EvaluateMemoryWriteInput): MemoryWriteDraft | undefined {
  const kind = classifyMemoryEvent(input.event);
  if (!kind) return undefined;
  if (!isEventRelevantToAgent(input.agentId, input.event)) return undefined;

  return {
    agentId: input.agentId,
    kind,
    summary: input.summary ?? summarizeMemoryEvent(input.event),
    eventId: input.event.id,
    importance: importanceFor(kind, input.event.severity),
  };
}

export function classifyMemoryEvent(
  event: Pick<GameEvent, "type" | "severity" | "payload">,
): MemoryWriteKind | undefined {
  const type = event.type.toLowerCase();
  const payloadText = JSON.stringify(event.payload).toLowerCase();

  if (type.includes("role") && (type.includes("change") || type.includes("mutation"))) {
    return "role_change";
  }
  if (type.includes("betray") || payloadText.includes("betrayal")) {
    return "betrayal";
  }
  if (type.includes("promise") || payloadText.includes("promise")) {
    return "promise";
  }
  if (type.includes("help") || /\b(help me|need help|assist|rescue|backup)\b/.test(payloadText)) {
    return "help_request";
  }
  if (type.includes("cooperat") || /\b(shared|protected|rescued|helped|teamed up|covered)\b/.test(payloadText)) {
    return "cooperation";
  }
  if (event.severity >= 3 && (
    type.includes("attack")
    || type.includes("damage")
    || /\b(attacked|stole|blocked|threatened)\b/.test(payloadText)
  )) {
    return "conflict";
  }
  if (
    type.includes("discover")
    || type.includes("found")
    || payloadText.includes("discovered")
    || payloadText.includes("diamond")
  ) {
    return "discovery";
  }
  if (event.severity >= 4) {
    return "important_event";
  }

  return undefined;
}

function importanceFor(kind: MemoryWriteKind, severity: GameEvent["severity"]): 3 | 4 | 5 {
  if (kind === "betrayal" || kind === "role_change" || severity >= 5) return 5;
  if (kind === "important_event" || kind === "discovery" || kind === "help_request" || kind === "conflict") return 4;
  return 3;
}

function summarizeMemoryEvent(
  event: Pick<GameEvent, "type" | "actorId" | "targetId">,
): string {
  const actors = [event.actorId, event.targetId].filter(Boolean).join(" -> ");
  return actors ? `${event.type}: ${actors}` : event.type;
}

function isEventRelevantToAgent(
  agentId: string,
  event: Pick<GameEvent, "actorId" | "targetId" | "payload">,
): boolean {
  const routedIds = [
    event.actorId,
    event.targetId,
    stringPayload(event.payload.agentId),
    stringPayload(event.payload.targetAgentId),
    ...stringArrayPayload(event.payload.agentIds),
    ...stringArrayPayload(event.payload.recipientIds),
    ...stringArrayPayload(event.payload.witnessAgentIds),
    ...stringArrayPayload(event.payload.mentionedAgentIds),
  ].filter((value): value is string => Boolean(value));

  return routedIds.length === 0 || routedIds.includes(agentId);
}

function stringPayload(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayPayload(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
