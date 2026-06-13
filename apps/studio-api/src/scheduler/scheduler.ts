import { randomUUID } from "node:crypto";

import type { AgentConfig, GameEvent } from "@mc-ai-video/contracts";

import type { ReflectionService } from "../memory/reflection";
import type { RoutineActionIntent } from "../routines";
import { ActionSlotRunner } from "./action-runner";
import { cancellationTargetsForEvent, routeWakeEvent } from "./events";
import type { RuntimeState } from "./runtime";
import type {
  AgentSchedulerState,
  SchedulerDependencies,
  SchedulerEvent,
  WakeReason,
} from "./types";

const ROUTINE_IDLE_TRACE_COOLDOWN_MS = 10_000;

export class AgentScheduler {
  private readonly agents: AgentConfig[];
  private readonly states = new Map<string, RuntimeState>();
  private readonly actionRunner: ActionSlotRunner;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private reflection?: ReflectionService;
  private pendingActionCursor = 0;
  private readonly routineIdleTraces = new Map<string, { key: string; at: number }>();

  public constructor(private readonly deps: SchedulerDependencies) {
    this.agents = [...deps.agents].sort((left, right) => left.id.localeCompare(right.id));
    this.now = deps.now ?? Date.now;
    this.idFactory = deps.idFactory ?? randomUUID;
    this.reflection = deps.reflection;
    this.actionRunner = new ActionSlotRunner({
      actions: deps.actions,
      now: this.now,
      idFactory: this.idFactory,
      emit: (event) => this.emit(event),
    });
    for (const agent of this.agents) {
      this.states.set(agent.id, {
        publicState: {
          agentId: agent.id,
          mode: agent.mode ?? "routine",
          planningQueued: false,
          planning: false,
          nextPlanAt: 0,
        },
      });
    }
  }

  public setReflectionService(reflection: ReflectionService): void {
    this.reflection = reflection;
  }

  public addAgent(agent: AgentConfig): boolean {
    if (this.states.has(agent.id)) {
      return false;
    }
    this.agents.push(agent);
    this.agents.sort((left, right) => left.id.localeCompare(right.id));
    this.states.set(agent.id, {
      publicState: {
        agentId: agent.id,
        mode: agent.mode ?? "routine",
        planningQueued: false,
        planning: false,
        nextPlanAt: 0,
      },
    });
    this.queuePlanning(agent.id, { type: "manual" });
    return true;
  }

  public agentIds(): string[] {
    return this.agents.map((agent) => agent.id);
  }

  public queuePlanning(agentId: string, reason: WakeReason = { type: "manual" }): void {
    const state = this.states.get(agentId);
    if (!state || state.publicState.mode === "paused" || state.publicState.mode === "failed") {
      return;
    }
    state.publicState.planningQueued = true;
    state.publicState.wakeReason = reason;
    this.emit({
      type: "scheduler.wake",
      agentId,
      severity: reason.event?.severity ?? 2,
      payload: { reason: reason.type },
    });
  }

  public handleEvent(event: GameEvent): void {
    const cancelTargets = cancellationTargetsForEvent(event);
    if (cancelTargets === "all") {
      for (const agent of this.agents) this.cancelAgent(agent.id, event.type);
    } else {
      for (const agentId of cancelTargets) this.cancelAgent(agentId, event.type);
    }

    const routed = routeWakeEvent(event, this.agents);
    for (const [agentId, reason] of routed) this.queuePlanning(agentId, reason);

    if (event.severity >= 4 && this.reflection) {
      const agentIds = routed.size > 0 ? [...routed.keys()] : compact([event.actorId, event.targetId]);
      const result = this.reflection.requestReflection({
        event,
        agentIds,
        reason: "major-event",
      });
      if (result instanceof Promise) result.catch(() => undefined);
    }
  }

  public async tick(): Promise<void> {
    const now = this.now();

    this.startPendingActions();

    // Priority stays deterministic: queued planners fill limited slots by agent id order.
    for (const agent of this.agents) {
      if (this.activePlanningCount() >= this.deps.config.maxPlanningSlots) break;
      const state = this.states.get(agent.id);
      if (
        state?.publicState.planningQueued &&
        !state.publicState.planning &&
        now >= state.publicState.nextPlanAt
      ) {
        this.startPlanning(agent, state);
      }
    }

    for (const agent of this.agents) {
      const state = this.states.get(agent.id);
      if (!state || !this.canRunRoutine(state)) continue;
      const routineId = agent.routine ?? agent.role;
      const routine = this.deps.routines.get(routineId);
      if (!routine) continue;

      const perception = await this.deps.perception.snapshot(agent);
      const survivalRoutine = this.deps.routines.get("survival");
      if (survivalRoutine && survivalRoutine.id !== routineId) {
        const survivalResult = survivalRoutine.run(agent, perception);
        this.emitRoutineEvents(survivalResult.taskEvents);
        if (survivalResult.wantsPlanning) this.queuePlanning(agent.id, { type: "manual" });
        if (survivalResult.action) {
          this.startOrQueueAction(agent, state, survivalResult.action);
          continue;
        }
        if (survivalResult.status === "failed") {
          continue;
        }
      }

      const result = routine.run(agent, perception);
      this.emitRoutineEvents(result.taskEvents);
      if (result.wantsPlanning) this.queuePlanning(agent.id, { type: "manual" });
      if (result.action) {
        this.startOrQueueAction(agent, state, result.action);
      }
    }
  }

  public pauseAgent(agentId: string): void {
    const state = this.states.get(agentId);
    if (!state) return;
    state.publicState.mode = "paused";
    this.cancelAgent(agentId, "pause");
  }

  public resumeAgent(agentId: string, reason: WakeReason = { type: "manual" }): void {
    const state = this.states.get(agentId);
    if (!state || state.publicState.mode === "failed") return;
    if (state.publicState.mode === "paused") {
      const agent = this.agents.find((item) => item.id === agentId);
      state.publicState.mode = agent?.mode ?? "routine";
    }
    this.queuePlanning(agentId, reason);
  }

  public disconnectAgent(agentId: string): void {
    const state = this.states.get(agentId);
    if (!state) return;
    state.publicState.mode = "failed";
    this.cancelAgent(agentId, "disconnect");
  }

  public directorInterrupt(agentId?: string): void {
    if (agentId) {
      this.cancelAgent(agentId, "director_interrupt");
      return;
    }
    for (const agent of this.agents) this.cancelAgent(agent.id, "director_interrupt");
  }

  public activePlanningCount(): number {
    return [...this.states.values()].filter((state) => state.publicState.planning).length;
  }

  public activeActionCount(): number {
    return this.actionRunner.activeCount(this.states.values());
  }

  public stateFor(agentId: string): AgentSchedulerState | undefined {
    const state = this.states.get(agentId)?.publicState;
    return state ? { ...state } : undefined;
  }

  public async waitForIdle(): Promise<void> {
    const pending = [...this.states.values()].flatMap((state) =>
      [state.action?.promise, state.planningPromise].filter(
        (promise): promise is Promise<void> => Boolean(promise),
      ),
    );
    await Promise.allSettled(pending);
  }

  private startPendingActions(): void {
    if (this.agents.length === 0) {
      return;
    }

    const startIndex = this.pendingActionCursor % this.agents.length;
    for (let offset = 0; offset < this.agents.length; offset += 1) {
      if (this.activeActionCount() >= this.deps.config.maxConcurrentActions) break;
      const index = (startIndex + offset) % this.agents.length;
      const agent = this.agents[index];
      if (!agent) continue;
      const state = this.states.get(agent.id);
      if (!state?.pendingAction || state.action || state.publicState.mode === "paused" || state.publicState.mode === "failed") {
        continue;
      }
      const intent = state.pendingAction;
      state.pendingAction = undefined;
      this.actionRunner.start(agent, state, intent);
      this.pendingActionCursor = (index + 1) % this.agents.length;
    }
  }

  private startOrQueueAction(agent: AgentConfig, state: RuntimeState, intent: RoutineActionIntent): void {
    if (this.activeActionCount() < this.deps.config.maxConcurrentActions) {
      this.actionRunner.start(agent, state, intent);
      return;
    }
    state.pendingAction = intent;
    this.emit({
      type: "scheduler.action.queued",
      agentId: agent.id,
      severity: 1,
      payload: { action: intent.action },
    });
  }

  private startPlanning(agent: AgentConfig, state: RuntimeState): void {
    const reason = state.publicState.wakeReason ?? { type: "manual" as const };
    const controller = new AbortController();
    state.publicState.planning = true;
    state.publicState.planningQueued = false;
    state.publicState.mode = "planning";
    state.publicState.nextPlanAt = this.now() + this.deps.config.planningCooldownMs;
    state.planningController = controller;
    this.emit({
      type: "scheduler.planning.started",
      agentId: agent.id,
      severity: reason.event?.severity ?? 2,
      payload: { reason: reason.type },
    });

    let planningError: string | undefined;
    let planningNote: string | undefined;
    state.planningPromise = (async () => {
      try {
        const perception = await this.deps.perception.snapshot(agent);
        const decision = await this.deps.planner.plan(agent, perception, reason, controller.signal);
        planningNote = decision.note;
        if (decision.action) {
          this.startOrQueueAction(agent, state, decision.action);
        }
      } catch (error) {
        planningError = error instanceof Error ? error.message : "planning failed";
      } finally {
        state.publicState.planning = false;
        state.planningController = undefined;
        state.planningPromise = undefined;
        if (state.publicState.mode === "planning") state.publicState.mode = agent.mode ?? "routine";
        this.emit({
          type: "scheduler.planning.finished",
          agentId: agent.id,
          severity: planningError ? 3 : 1,
          payload: planningError
            ? { reason: reason.type, error: planningError }
            : { reason: reason.type, ...(planningNote ? { note: planningNote } : {}) },
        });
      }
    })();
  }

  private cancelAgent(agentId: string, reason: string): void {
    const state = this.states.get(agentId);
    if (!state) return;

    this.actionRunner.cancel(agentId, state, reason);
    state.pendingAction = undefined;
    state.planningController?.abort(reason);
    state.publicState.planningQueued = false;
  }

  private canRunRoutine(state: RuntimeState): boolean {
    return (
      state.publicState.mode === "routine" &&
      !state.publicState.planning &&
      !state.publicState.planningQueued &&
      !state.action &&
      !state.pendingAction
    );
  }

  private emit(event: SchedulerEvent): void {
    this.deps.events?.publish(event);
  }

  private emitRoutineEvents(events: SchedulerEvent[]): void {
    for (const event of events) {
      if (event.type === "routine.task" && !this.shouldEmitRoutineTask(event)) {
        continue;
      }
      this.emit(event);
    }
  }

  private shouldEmitRoutineTask(event: Extract<SchedulerEvent, { type: "routine.task" }>): boolean {
    if (event.status !== "idle") {
      this.routineIdleTraces.delete(event.agentId);
      return true;
    }

    const key = `${event.routineId}:${event.message}:${String(event.payload.reason ?? event.payload.blockedReason ?? "")}`;
    const now = this.now();
    const previous = this.routineIdleTraces.get(event.agentId);
    if (previous && previous.key === key && now - previous.at < ROUTINE_IDLE_TRACE_COOLDOWN_MS) {
      return false;
    }

    this.routineIdleTraces.set(event.agentId, { key, at: now });
    return true;
  }
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
