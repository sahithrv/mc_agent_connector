import type { ActionRequest, ActionResult, AgentConfig, JsonValue } from "@mc-ai-video/contracts";

import type { RoutineActionIntent } from "../routines";
import type { RuntimeState } from "./runtime";
import type { ActionRegistry, SchedulerEvent } from "./types";

interface ActionRunnerDependencies {
  actions: ActionRegistry;
  now: () => number;
  idFactory: () => string;
  emit(event: SchedulerEvent): void;
}

export class ActionSlotRunner {
  public constructor(private readonly deps: ActionRunnerDependencies) {}

  public activeCount(states: Iterable<RuntimeState>): number {
    return [...states].filter((state) => state.action).length;
  }

  public start(agent: AgentConfig, state: RuntimeState, intent: RoutineActionIntent): void {
    const request = this.toActionRequest(agent, intent);
    if (!this.deps.actions.canRun(agent, request)) {
      this.deps.emit({
        type: "scheduler.action.rejected",
        agentId: agent.id,
        severity: 3,
        payload: actionPayload(request),
      });
      return;
    }

    const controller = new AbortController();
    state.publicState.mode = "acting";
    state.publicState.currentActionId = request.id;
    this.deps.emit({
      type: "scheduler.action.started",
      agentId: agent.id,
      severity: 1,
      payload: actionPayload(request),
    });

    const promise = this.deps.actions
      .run(agent, request, controller.signal)
      .then((result) => this.finish(agent, state, result))
      .catch((error: unknown) => {
        this.finish(agent, state, {
          requestId: request.id,
          agentId: agent.id,
          action: request.action,
          ok: false,
          startedAt: request.createdAt,
          completedAt: new Date(this.deps.now()).toISOString(),
          error: error instanceof Error ? error.message : "action failed",
          params: request.params,
          requestedBy: request.requestedBy,
          source: request.source,
          targetKey: request.targetKey,
        });
      });

    state.action = { request, controller, promise };
  }

  public cancel(agentId: string, state: RuntimeState, reason: string): void {
    // Cancellation is cooperative; long registry actions must honor the abort signal.
    if (!state.action) return;
    state.action.controller.abort(reason);
    this.deps.emit({
      type: "scheduler.action.canceled",
      agentId,
      severity: 3,
      payload: { action: state.action.request.action, reason },
    });
  }

  private finish(agent: AgentConfig, state: RuntimeState, result: ActionResult): void {
    if (state.action?.request.id !== result.requestId) return;
    state.action = undefined;
    state.publicState.currentActionId = undefined;
    if (state.publicState.mode === "acting") state.publicState.mode = agent.mode ?? "routine";
    const payload: Record<string, JsonValue> = {
      action: result.action,
      requestId: result.requestId,
      ok: result.ok,
    };
    if (result.error) payload.error = result.error;
    if (result.data) payload.data = result.data;
    if (result.params) payload.params = result.params;
    if (result.requestedBy) payload.requestedBy = result.requestedBy;
    if (result.source) payload.source = result.source;
    if (result.targetKey) payload.targetKey = result.targetKey;
    this.deps.emit({
      type: "scheduler.action.finished",
      agentId: agent.id,
      severity: result.ok ? 1 : 3,
      payload,
    });
  }

  private toActionRequest(agent: AgentConfig, intent: RoutineActionIntent): ActionRequest {
    const timeoutMs = intent.timeoutMs === undefined
      ? undefined
      : Math.max(intent.timeoutMs, minimumTimeoutForIntent(intent));
    return {
      id: this.deps.idFactory(),
      agentId: agent.id,
      action: intent.action,
      params: intent.params,
      requestedBy: intent.requestedBy ?? "scheduler",
      source: intent.source,
      targetKey: intent.targetKey,
      timeoutMs,
      createdAt: new Date(this.deps.now()).toISOString(),
    };
  }
}

function actionPayload(request: ActionRequest): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    action: request.action,
    requestId: request.id,
    params: request.params,
  };
  if (request.requestedBy) payload.requestedBy = request.requestedBy;
  if (request.source) payload.source = request.source;
  if (request.targetKey) payload.targetKey = request.targetKey;
  const reason = request.params.reason;
  if (typeof reason === "string" && reason.trim().length > 0) payload.reason = reason;
  return payload;
}

function minimumTimeoutForIntent(intent: RoutineActionIntent): number {
  const duration = intent.params.durationMs;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return duration + 1_000;
  }
  return intent.action === "idle" ? 2_000 : 1_000;
}
