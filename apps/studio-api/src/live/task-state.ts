import type { ActionResult, JsonValue } from "@mc-ai-video/contracts";

export type PlanStepStatus = "pending" | "active" | "done" | "blocked" | "failed";

export interface PlanStep {
  id: string;
  description: string;
  status: PlanStepStatus;
  neededItems?: Record<string, number>;
  target?: JsonValue;
  blocker?: string;
  successCondition?: string;
  nextAction?: string;
  skill?: string;
}

export interface AgentTaskState {
  agentId: string;
  goal?: string;
  plan: PlanStep[];
  currentStepId?: string;
  updatedAt: string;
}

export interface SetPlanInput {
  agentId: string;
  goal?: string;
  steps: PlanStep[];
  currentStepId?: string;
  updatedAt?: string;
}

export interface PromptTaskState {
  goal?: string;
  currentStepId?: string;
  updatedAt: string;
  plan: PlanStep[];
}

const MAX_PLAN_STEPS = 8;
const MAX_PROMPT_STEPS = 6;
const REPEATED_BLOCK_COUNT = 2;

export class AgentTaskStateStore {
  private readonly states = new Map<string, AgentTaskState>();
  private readonly pendingPlanReasons = new Map<string, string>();
  private readonly blockedCounts = new Map<string, number>();

  public stateFor(agentId: string): AgentTaskState {
    return cloneState(this.getOrCreate(agentId));
  }

  public setGoal(agentId: string, goal: string | undefined): boolean {
    const state = this.getOrCreate(agentId);
    const normalizedGoal = normalizeText(goal);
    if (normalizeText(state.goal) === normalizedGoal) {
      return false;
    }

    state.goal = normalizedGoal || undefined;
    state.plan = [];
    state.currentStepId = undefined;
    state.updatedAt = nowIso();
    this.clearBlockedCounts(agentId);
    if (state.goal) {
      this.pendingPlanReasons.set(agentId, "new_goal");
    } else {
      this.pendingPlanReasons.delete(agentId);
    }
    return true;
  }

  public setPlan(input: SetPlanInput): AgentTaskState {
    const state = this.getOrCreate(input.agentId);
    const goal = normalizeText(input.goal) || state.goal;
    const steps = normalizePlan(input.steps);
    state.goal = goal || undefined;
    state.plan = activateOneStep(steps, input.currentStepId);
    state.currentStepId = activeStepId(state.plan);
    state.updatedAt = input.updatedAt ?? nowIso();
    this.clearBlockedCounts(input.agentId);
    this.pendingPlanReasons.delete(input.agentId);
    return cloneState(state);
  }

  public recordActionResult(result: ActionResult): AgentTaskState | undefined {
    const state = this.states.get(result.agentId);
    if (!state || state.plan.length === 0) {
      return undefined;
    }

    const step = matchingStep(state, result);
    if (!step) {
      return cloneState(state);
    }

    if (result.ok) {
      if (result.action !== "idle") {
        if (isProgressSensitiveAction(result.action) && hasExplicitNoProgress(result)) {
          this.markStepBlocked(
            state,
            result.agentId,
            step,
            `no measurable progress from ${result.action}`,
          );
        } else {
          step.status = "done";
          step.blocker = undefined;
          this.blockedCounts.delete(blockedKey(result.agentId, step.id));
          promoteNextStep(state);
        }
      }
    } else {
      this.markStepBlocked(state, result.agentId, step, result.error ?? `${result.action} failed`);
    }

    state.updatedAt = result.completedAt || nowIso();
    return cloneState(state);
  }

  public pendingPlanReason(agentId: string): string | undefined {
    return this.pendingPlanReasons.get(agentId);
  }

  public markPlanUpdated(agentId: string): void {
    this.pendingPlanReasons.delete(agentId);
  }

  public currentStepBlockedRepeatedly(agentId: string): boolean {
    const state = this.states.get(agentId);
    const stepId = state?.currentStepId;
    if (!stepId) {
      return false;
    }
    return (this.blockedCounts.get(blockedKey(agentId, stepId)) ?? 0) >= REPEATED_BLOCK_COUNT;
  }

  public currentStepBlockedCount(agentId: string): number {
    const state = this.states.get(agentId);
    const stepId = state?.currentStepId;
    return stepId ? this.blockedCounts.get(blockedKey(agentId, stepId)) ?? 0 : 0;
  }

  public toPromptState(agentId: string): PromptTaskState | undefined {
    const state = this.states.get(agentId);
    if (!state || (!state.goal && state.plan.length === 0)) {
      return undefined;
    }
    const prioritized = [
      ...state.plan.filter((step) => step.status === "active" || step.id === state.currentStepId),
      ...state.plan.filter((step) => step.status === "blocked"),
      ...state.plan.filter((step) => step.status === "pending"),
      ...state.plan.filter((step) => step.status === "done"),
      ...state.plan.filter((step) => step.status === "failed"),
    ];
    const seen = new Set<string>();
    return {
      goal: state.goal,
      currentStepId: state.currentStepId,
      updatedAt: state.updatedAt,
      plan: prioritized
        .filter((step) => {
          if (seen.has(step.id)) return false;
          seen.add(step.id);
          return true;
        })
        .slice(0, MAX_PROMPT_STEPS)
        .map(cloneStep),
    };
  }

  private markStepBlocked(
    state: AgentTaskState,
    agentId: string,
    step: PlanStep,
    blocker: string,
  ): void {
    step.status = "blocked";
    step.blocker = blocker;
    state.currentStepId = step.id;
    const key = blockedKey(agentId, step.id);
    const count = (this.blockedCounts.get(key) ?? 0) + 1;
    this.blockedCounts.set(key, count);
    if (count >= REPEATED_BLOCK_COUNT) {
      this.pendingPlanReasons.set(agentId, "blocked_repeatedly");
    }
  }

  private getOrCreate(agentId: string): AgentTaskState {
    const existing = this.states.get(agentId);
    if (existing) {
      return existing;
    }
    const created: AgentTaskState = {
      agentId,
      plan: [],
      updatedAt: nowIso(),
    };
    this.states.set(agentId, created);
    return created;
  }

  private clearBlockedCounts(agentId: string): void {
    for (const key of this.blockedCounts.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.blockedCounts.delete(key);
      }
    }
  }
}

function normalizePlan(steps: PlanStep[]): PlanStep[] {
  return steps
    .slice(0, MAX_PLAN_STEPS)
    .map((step, index) => normalizePlanStep(step, index))
    .filter((step): step is PlanStep => Boolean(step));
}

function normalizePlanStep(step: PlanStep, index: number): PlanStep | undefined {
  const description = normalizeText(step.description);
  if (!description) {
    return undefined;
  }
  const neededItems = step.neededItems
    ? Object.fromEntries(
        Object.entries(step.neededItems)
          .filter((entry): entry is [string, number] =>
            normalizeText(entry[0]).length > 0 && Number.isFinite(entry[1]) && entry[1] > 0,
          )
          .map(([key, value]) => [normalizeName(key), Math.ceil(value)]),
      )
    : undefined;
  return {
    id: normalizeId(step.id) || `step-${index + 1}`,
    description,
    status: isStepStatus(step.status) ? step.status : "pending",
    neededItems: neededItems && Object.keys(neededItems).length > 0 ? neededItems : undefined,
    target: cloneJson(step.target),
    blocker: normalizeText(step.blocker) || undefined,
    successCondition: normalizeText(step.successCondition) || undefined,
    nextAction: normalizeText(step.nextAction) || undefined,
    skill: normalizeText(step.skill) || undefined,
  };
}

function activateOneStep(steps: PlanStep[], preferredStepId: string | undefined): PlanStep[] {
  if (steps.length === 0) {
    return [];
  }
  const preferred = preferredStepId
    ? steps.find((step) => step.id === preferredStepId && !terminalStatus(step.status))
    : undefined;
  const active = preferred
    ?? steps.find((step) => step.status === "active" && !terminalStatus(step.status))
    ?? steps.find((step) => step.status === "blocked")
    ?? steps.find((step) => step.status === "pending")
    ?? steps.find((step) => !terminalStatus(step.status));

  return steps.map((step) => {
    if (!active || step.id !== active.id) {
      return step.status === "active" ? { ...step, status: "pending" } : step;
    }
    return { ...step, status: step.status === "blocked" ? "blocked" : "active" };
  });
}

function promoteNextStep(state: AgentTaskState): void {
  const next = state.plan.find((step) => step.status === "pending" || step.status === "blocked");
  if (!next) {
    state.currentStepId = undefined;
    return;
  }
  next.status = next.status === "blocked" ? "blocked" : "active";
  state.currentStepId = next.id;
}

function activeStepId(plan: PlanStep[]): string | undefined {
  return plan.find((step) => step.status === "active" || step.status === "blocked")?.id;
}

function matchingStep(state: AgentTaskState, result: ActionResult): PlanStep | undefined {
  const active = state.currentStepId
    ? state.plan.find((step) => step.id === state.currentStepId)
    : state.plan.find((step) => step.status === "active" || step.status === "blocked");
  if (active && stepMatchesResult(active, result)) {
    return active;
  }
  return state.plan.find((step) => !terminalStatus(step.status) && stepMatchesResult(step, result))
    ?? active
    ?? state.plan.find((step) => step.status === "pending");
}

function stepMatchesResult(step: PlanStep, result: ActionResult): boolean {
  if (step.nextAction && normalizeName(step.nextAction) === normalizeName(result.action)) {
    return true;
  }
  const text = [
    step.description,
    step.successCondition,
    step.skill,
    step.target ? JSON.stringify(step.target) : undefined,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text) {
    return false;
  }
  const action = normalizeName(result.action);
  if (text.includes(action) || text.includes(action.replace(/_/g, " "))) {
    return true;
  }
  return actionTargetTerms(result).some((term) => text.includes(term.toLowerCase()));
}

function actionTargetTerms(result: ActionResult): string[] {
  const params = result.params ?? {};
  return ["block", "item", "name", "username", "player", "target", "entityId"]
    .map((key) => params[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function isProgressSensitiveAction(action: string): boolean {
  return [
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "mine_block",
    "craft_item",
    "place_block",
    "attack_entity",
    "harvest_crop",
    "plant_crop",
  ].includes(normalizeName(action));
}

function hasExplicitNoProgress(result: ActionResult): boolean {
  const signal = objectValue(result.data?.progressSignal);
  return signal?.baseline === true && signal.changed === false;
}

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JsonValue>
    : undefined;
}

function terminalStatus(status: PlanStepStatus): boolean {
  return status === "done" || status === "failed";
}

function isStepStatus(value: unknown): value is PlanStepStatus {
  return value === "pending"
    || value === "active"
    || value === "done"
    || value === "blocked"
    || value === "failed";
}

function cloneState(state: AgentTaskState): AgentTaskState {
  return {
    agentId: state.agentId,
    goal: state.goal,
    plan: state.plan.map(cloneStep),
    currentStepId: state.currentStepId,
    updatedAt: state.updatedAt,
  };
}

function cloneStep(step: PlanStep): PlanStep {
  return {
    id: step.id,
    description: step.description,
    status: step.status,
    neededItems: step.neededItems ? { ...step.neededItems } : undefined,
    target: cloneJson(step.target),
    blocker: step.blocker,
    successCondition: step.successCondition,
    nextAction: step.nextAction,
    skill: step.skill,
  };
}

function cloneJson<T extends JsonValue | undefined>(value: T): T {
  if (value === undefined) {
    return undefined as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeId(value: string | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function blockedKey(agentId: string, stepId: string): string {
  return `${agentId}:${stepId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}
