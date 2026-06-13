import type { AgentConfig, AiChatMessage, GameEvent, JsonValue } from "@mc-ai-video/contracts";

import type { PlanStep } from "../../live/task-state";
import type { LlmProviderRegistry } from "../providers";
import type { LlmError, LlmRequest, LlmUsage } from "../providers/types";
import {
  buildAgentPlanPrompt,
  buildPersonaSystemPrompt,
  buildPromptContext,
  type ActiveScenarioContext,
  type ActionResultContext,
  type DynamicAgentState,
  type MemoryContext,
  type PromptActionAffordance,
  type PromptPerceptionSnapshot,
  type PromptRecoveryContext,
  type PromptTaskState,
  type RelationshipContext,
  type StaticPersona,
} from "../prompts";
import { AgentTaskPlanSchema, type AgentTaskPlan } from "../schemas/agent-plan";
import type { AgentDecision } from "../schemas/agent-decision";
import {
  allowedDecisionActionsForAgent,
  promptActionDescriptions,
} from "./intent-map";
import type { DecisionModelConfig } from "./service";

export interface AgentPlanServiceInput {
  agent: Pick<AgentConfig, "id" | "name" | "role" | "team" | "subteam" | "leader" | "routine" | "allowedActions">;
  model: DecisionModelConfig;
  goal: string;
  trigger: string;
  staticPersona: StaticPersona;
  dynamicState?: DynamicAgentState;
  perception?: PromptPerceptionSnapshot;
  relationships?: RelationshipContext[];
  memories?: MemoryContext[];
  recentActionResults?: ActionResultContext[];
  affordances?: PromptActionAffordance[];
  recovery?: PromptRecoveryContext;
  taskState?: PromptTaskState;
  recentChat?: AiChatMessage[];
  recentEvents?: GameEvent[];
  activeScenario?: ActiveScenarioContext;
  availableActions?: AgentDecision["action"][];
  availableSkills?: string[];
  maxContextChars?: number;
}

export interface GeneratedAgentPlan {
  goal?: string;
  steps: PlanStep[];
  currentStepId?: string;
  reasoningSummary?: string;
}

export interface AgentPlanServiceResult {
  plan: GeneratedAgentPlan;
  fallback: boolean;
  fallbackReason?: string;
  usage?: LlmUsage;
  request: LlmRequest;
}

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 10_000;

export class AgentPlanService {
  public constructor(private readonly providers: LlmProviderRegistry) {}

  public async updatePlan(input: AgentPlanServiceInput): Promise<AgentPlanServiceResult> {
    const availableActions = input.availableActions ?? allowedDecisionActionsForAgent(input.agent);
    const request = this.buildRequest(input, availableActions);
    const result = await this.providers.generateStructured(request, AgentTaskPlanSchema);
    if (!result.ok) {
      const reason = providerErrorReason(result.error);
      return this.withFallback(input, request, availableActions, reason);
    }

    const parsed = AgentTaskPlanSchema.safeParse(result.value);
    if (!parsed.success) {
      const reason = schemaErrorReason(parsed.error.issues);
      return this.withFallback(input, request, availableActions, reason);
    }

    return {
      plan: toGeneratedPlan(parsed.data, input.goal, availableActions),
      fallback: false,
      usage: result.usage,
      request,
    };
  }

  private buildRequest(
    input: AgentPlanServiceInput,
    availableActions: AgentDecision["action"][],
  ): LlmRequest {
    const context = buildPromptContext({
      agent: input.agent,
      staticPersona: input.staticPersona,
      dynamicState: input.dynamicState,
      perception: input.perception,
      relationships: input.relationships,
      memories: input.memories,
      recentActionResults: input.recentActionResults,
      affordances: input.affordances,
      recovery: input.recovery,
      taskState: input.taskState,
      recentChat: input.recentChat,
      recentEvents: input.recentEvents,
      activeScenario: input.activeScenario,
      maxChars: input.maxContextChars,
    });
    return {
      provider: input.model.provider,
      model: input.model.model,
      system: buildPersonaSystemPrompt(input.staticPersona),
      messages: [{
        role: "user",
        content: buildAgentPlanPrompt({
          context,
          goal: input.goal,
          trigger: input.trigger,
          availableActions: promptActionDescriptions(availableActions),
          availableSkills: input.availableSkills,
        }),
      }],
      schemaName: "AgentTaskPlan",
      temperature: input.model.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: input.model.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  private withFallback(
    input: AgentPlanServiceInput,
    request: LlmRequest,
    availableActions: AgentDecision["action"][],
    reason: string,
  ): AgentPlanServiceResult {
    return {
      plan: fallbackPlan(input, availableActions, reason),
      fallback: true,
      fallbackReason: reason,
      request,
    };
  }
}

function toGeneratedPlan(
  plan: AgentTaskPlan,
  fallbackGoal: string,
  availableActions: AgentDecision["action"][],
): GeneratedAgentPlan {
  const allowed = new Set<string>(availableActions);
  const steps = plan.steps.map((step, index): PlanStep => {
    const nextAction = step.nextAction && allowed.has(step.nextAction)
      ? step.nextAction
      : undefined;
    return {
      id: normalizeStepId(step.id) || `step-${index + 1}`,
      description: trimText(step.description, 180),
      status: step.status,
      neededItems: normalizeNeededItems(step.neededItems),
      target: isJsonValue(step.target) ? step.target : undefined,
      blocker: trimOptional(step.blocker, 180),
      successCondition: trimOptional(step.successCondition, 180),
      nextAction,
      skill: trimOptional(step.skill, 80),
    };
  });
  const currentStepId = plan.currentStepId && steps.some((step) => step.id === plan.currentStepId)
    ? plan.currentStepId
    : steps.find((step) => step.status === "active" || step.status === "blocked")?.id
      ?? steps.find((step) => step.status === "pending")?.id;
  return {
    goal: plan.goal ?? fallbackGoal,
    steps,
    currentStepId,
    reasoningSummary: trimOptional(plan.reasoningSummary, 240),
  };
}

function fallbackPlan(
  input: AgentPlanServiceInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): GeneratedAgentPlan {
  const steps: PlanStep[] = [];
  const executable = (input.affordances ?? [])
    .filter((affordance) => !affordance.blocked)
    .sort(compareAffordance)
    .slice(0, 3);
  const blocked = (input.affordances ?? [])
    .filter((affordance) => affordance.blocked)
    .sort(compareAffordance)
    .slice(0, 2);

  if (input.recovery?.hint || input.recovery?.reason) {
    steps.push({
      id: "resolve-blocker",
      description: trimText(input.recovery.hint ?? input.recovery.reason ?? "Resolve the current blocker.", 180),
      status: "active",
      blocker: input.recovery.reason,
      successCondition: "A different target/action succeeds or the blocking precondition is satisfied.",
      nextAction: firstAllowedAction(executable, availableActions),
    });
  }

  for (const affordance of executable) {
    steps.push({
      id: `do-${normalizeStepId(affordance.action)}-${steps.length + 1}`,
      description: trimText(affordance.reason, 180),
      status: steps.length === 0 ? "active" : "pending",
      target: compactTarget(affordance.params),
      successCondition: `${affordance.action} succeeds without repeating a blocked target.`,
      nextAction: affordance.action,
    });
  }

  for (const affordance of blocked) {
    steps.push({
      id: `unblock-${normalizeStepId(affordance.action)}-${steps.length + 1}`,
      description: trimText(`Unblock ${affordance.action}: ${affordance.reason}`, 180),
      status: steps.length === 0 ? "active" : "pending",
      target: compactTarget(affordance.params),
      blocker: affordance.blockedReason,
      successCondition: "Missing tool, material, path, or target condition is resolved.",
      nextAction: firstAllowed(["craft_item", "move_to", "collect_item"], availableActions),
    });
  }

  const generic = genericFallbackSteps(input.goal, availableActions, reason);
  for (const step of generic) {
    if (steps.length >= 3) break;
    steps.push({
      ...step,
      status: steps.length === 0 ? "active" : "pending",
    });
  }

  const limited = steps.slice(0, 8).map((step, index) => ({
    ...step,
    id: step.id || `step-${index + 1}`,
    status: index === 0 && !steps.some((item) => item.status === "active") ? "active" as const : step.status,
  }));
  return {
    goal: input.goal,
    steps: limited,
    currentStepId: limited.find((step) => step.status === "active" || step.status === "blocked")?.id,
    reasoningSummary: `Fallback plan after plan generation failed: ${trimText(reason, 160)}`,
  };
}

function genericFallbackSteps(
  goal: string,
  availableActions: AgentDecision["action"][],
  reason: string,
): PlanStep[] {
  return [
    {
      id: "assess-visible-options",
      description: `Use visible inventory, entities, and blocks to choose progress toward: ${trimText(goal, 100)}`,
      status: "pending",
      successCondition: "A concrete executable action is selected from current perception.",
      nextAction: firstAllowed(["move_to", "continue_routine"], availableActions),
    },
    {
      id: "make-physical-progress",
      description: "Take the best available physical action instead of idling.",
      status: "pending",
      successCondition: "An action succeeds or returns a specific blocker.",
      nextAction: firstAllowed(["mine_block", "collect_item", "craft_item", "place_block", "move_to"], availableActions),
    },
    {
      id: "report-or-recover",
      description: `Report a concrete blocker only if no physical action can progress. Plan fallback reason: ${trimText(reason, 80)}`,
      status: "pending",
      successCondition: "Teammates receive a concise blocker or recovery action succeeds.",
      nextAction: firstAllowed(["chat_ai_private", "continue_routine", "idle"], availableActions),
    },
  ];
}

function compareAffordance(left: PromptActionAffordance, right: PromptActionAffordance): number {
  return Number(right.advancesGoal ?? false) - Number(left.advancesGoal ?? false)
    || right.score - left.score
    || left.action.localeCompare(right.action);
}

function firstAllowedAction(
  affordances: PromptActionAffordance[],
  availableActions: AgentDecision["action"][],
): AgentDecision["action"] | undefined {
  return affordances.find((affordance) => availableActions.includes(affordance.action))?.action
    ?? firstAllowed(["craft_item", "move_to", "collect_item", "mine_block", "place_block", "continue_routine"], availableActions);
}

function firstAllowed(
  candidates: AgentDecision["action"][],
  availableActions: AgentDecision["action"][],
): AgentDecision["action"] | undefined {
  return candidates.find((candidate) => availableActions.includes(candidate));
}

function compactTarget(params: Record<string, JsonValue>): JsonValue | undefined {
  const position = params.position;
  if (isJsonValue(position)) {
    return position;
  }
  for (const key of ["block", "item", "name", "username", "player", "target", "entityId"]) {
    const value = params[key];
    if (isJsonValue(value)) {
      return { [key]: value };
    }
  }
  return undefined;
}

function normalizeNeededItems(value: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => entry[0].trim().length > 0 && Number.isFinite(entry[1]) && entry[1] > 0)
      .map(([item, count]) => [item.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), Math.ceil(count)]),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function providerErrorReason(error: LlmError): string {
  return `${error.code}: ${error.message}`;
}

function schemaErrorReason(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const summary = issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
    .join("; ");
  return summary ? `provider returned invalid AgentTaskPlan: ${summary}` : "provider returned invalid AgentTaskPlan";
}

function trimOptional(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimText(trimmed, maxLength) : undefined;
}

function trimText(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function normalizeStepId(value: string | undefined): string {
  return value?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) ?? "";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}
