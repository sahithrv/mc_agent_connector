import type { ActionRequest, ActionResult, GameEvent, JsonValue } from "@mc-ai-video/contracts";

export type ActionLogStatus = "requested" | "running" | "succeeded" | "failed" | "rejected" | "canceled";

export interface ActionLogEntry {
  requestId: string;
  agentId: string;
  action: string;
  status: ActionLogStatus;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  request?: ActionRequest;
  result?: ActionResult;
}

export function createActionLogEntries(input: {
  requests?: ActionRequest[];
  results?: ActionResult[];
  events?: GameEvent[];
}): ActionLogEntry[] {
  const entries = new Map<string, ActionLogEntry>();

  for (const request of input.requests ?? []) {
    entries.set(request.id, {
      requestId: request.id,
      agentId: request.agentId,
      action: request.action,
      status: "requested",
      requestedAt: request.createdAt,
      request,
    });
  }

  for (const event of input.events ?? []) {
    if (!event.type.startsWith("scheduler.action.")) continue;
    const requestId = stringValue(event.payload.requestId) ?? event.id;
    const existing = entries.get(requestId);
    const base: ActionLogEntry = existing ?? {
      requestId,
      agentId: event.actorId ?? stringValue(event.payload.agentId) ?? "unknown",
      action: stringValue(event.payload.action) ?? event.type,
      status: "requested",
    };

    entries.set(requestId, {
      ...base,
      agentId: base.agentId === "unknown" ? event.actorId ?? stringValue(event.payload.agentId) ?? "unknown" : base.agentId,
      action: base.action === event.type ? stringValue(event.payload.action) ?? event.type : base.action,
      ...eventPatch(event),
    });
  }

  for (const result of input.results ?? []) {
    const existing = entries.get(result.requestId);
    entries.set(result.requestId, {
      requestId: result.requestId,
      agentId: existing?.agentId ?? result.agentId,
      action: existing?.action ?? result.action,
      status: result.ok ? "succeeded" : "failed",
      requestedAt: existing?.requestedAt,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      failureReason: result.error,
      request: existing?.request,
      result,
    });
  }

  return [...entries.values()].sort((left, right) => timestamp(right).localeCompare(timestamp(left)));
}

function eventPatch(event: GameEvent): Partial<ActionLogEntry> {
  if (event.type.endsWith(".started")) {
    return { status: "running", startedAt: event.timestamp };
  }

  if (event.type.endsWith(".finished")) {
    const ok = event.payload.ok === true;
    return {
      status: ok ? "succeeded" : "failed",
      completedAt: event.timestamp,
      failureReason: ok ? undefined : stringValue(event.payload.error) ?? stringValue(event.payload.reason),
    };
  }

  if (event.type.endsWith(".canceled")) {
    return {
      status: "canceled",
      completedAt: event.timestamp,
      failureReason: stringValue(event.payload.reason) ?? "canceled",
    };
  }

  if (event.type.endsWith(".rejected")) {
    return {
      status: "rejected",
      completedAt: event.timestamp,
      failureReason: stringValue(event.payload.reason) ?? "policy rejected action",
    };
  }

  return {};
}

function timestamp(entry: ActionLogEntry): string {
  return entry.completedAt ?? entry.startedAt ?? entry.requestedAt ?? "";
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
