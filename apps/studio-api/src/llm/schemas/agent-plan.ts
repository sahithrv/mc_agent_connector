import { z } from "zod";

import { JsonValueSchema } from "./json";

export const AgentPlanStepStatusSchema = z.enum(["pending", "active", "done", "blocked", "failed"]);

export const AgentPlanStepSchema = z.preprocess(normalizeStep, z.object({
  id: z.string().trim().min(1).max(48).optional(),
  description: z.string().trim().min(1).max(180),
  status: AgentPlanStepStatusSchema.default("pending"),
  neededItems: z.record(z.string().trim().min(1).max(80), z.number().finite().positive()).optional(),
  target: JsonValueSchema.optional(),
  blocker: z.string().trim().min(1).max(180).optional(),
  successCondition: z.string().trim().min(1).max(180).optional(),
  nextAction: z.string().trim().min(1).max(80).optional(),
  skill: z.string().trim().min(1).max(80).optional(),
}));

export const AgentTaskPlanSchema = z.preprocess(normalizePlan, z.object({
  goal: z.string().trim().min(1).max(240).optional(),
  steps: z.array(AgentPlanStepSchema).min(3).max(8),
  currentStepId: z.string().trim().min(1).max(48).optional(),
  reasoningSummary: z.string().trim().min(1).max(240).optional(),
}));

export type AgentTaskPlan = z.infer<typeof AgentTaskPlanSchema>;
export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;

function normalizePlan(value: unknown): unknown {
  const root = objectValue(value);
  if (!root) {
    return value;
  }
  const wrapped = objectValue(root.plan)
    ?? objectValue(root.taskPlan)
    ?? objectValue(root.agentTaskPlan)
    ?? objectValue(root.result);
  const source = wrapped ?? root;
  const rawSteps = Array.isArray(source.steps)
    ? source.steps
    : Array.isArray(source.plan)
      ? source.plan
      : Array.isArray(source.items)
        ? source.items
        : undefined;
  return compactUndefined({
    goal: source.goal ?? source.objective,
    steps: rawSteps?.slice(0, 8),
    currentStepId: source.currentStepId ?? source.current_step_id ?? source.nextStepId ?? source.next_step_id,
    reasoningSummary: source.reasoningSummary ?? source.reasoning_summary ?? source.summary ?? source.reasoning,
  });
}

function normalizeStep(value: unknown): unknown {
  const source = objectValue(value);
  if (!source) {
    return value;
  }
  const description = source.description ?? source.step ?? source.task ?? source.title;
  const nextAction = source.nextAction ?? source.next_action ?? source.action ?? source.next;
  return compactUndefined({
    ...source,
    id: source.id ?? source.stepId ?? source.step_id,
    description,
    status: source.status,
    neededItems: source.neededItems ?? source.needed_items ?? source.needs,
    target: source.target,
    blocker: source.blocker ?? source.blockedBy ?? source.blocked_by,
    successCondition: source.successCondition ?? source.success_condition ?? source.doneWhen ?? source.done_when,
    nextAction,
    skill: source.skill ?? source.nextSkill ?? source.next_skill,
  });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function compactUndefined(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, item]) => item !== undefined),
  );
}
