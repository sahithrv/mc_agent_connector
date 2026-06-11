import type { GameEvent } from "@mc-ai-video/contracts";

export type MemoryWriteKind =
  | "important_event"
  | "promise"
  | "betrayal"
  | "discovery"
  | "role_change";

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
  if (kind === "important_event" || kind === "discovery") return 4;
  return 3;
}

function summarizeMemoryEvent(
  event: Pick<GameEvent, "type" | "actorId" | "targetId">,
): string {
  const actors = [event.actorId, event.targetId].filter(Boolean).join(" -> ");
  return actors ? `${event.type}: ${actors}` : event.type;
}
