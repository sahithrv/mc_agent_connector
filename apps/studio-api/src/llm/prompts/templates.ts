import type { AgentDecision } from "../schemas/agent-decision";
import type { PromptContext, StaticPersona } from "./types";

export const DEFAULT_DECISION_CONSTRAINTS = [
  "Choose exactly one high-level action.",
  "Use only the listed actions and provide only parameters needed for that action.",
  "Use relationships and memories: help trusted allies, avoid or warn about low-trust/high-fear agents, and keep promises visible.",
  "Do not expose hidden reasoning; keep reasoningSummary short.",
  "Do not change static identity, role, team, or core persona during a decision.",
  "Avoid unsafe mining, griefing, friendly fire, and attacks on players unless explicitly allowed by scenario constraints.",
  "Use RECENT_ACTION_RESULTS: do not repeat the same failed action-target pair unless the blocker has changed.",
  "Prefer EXECUTABLE_NOW actions that advance the goal.",
  "If a recent action failed due to missing tool/material, choose an action that satisfies that precondition.",
  "Do not choose idle while any physical action or craftable precondition advances the active goal.",
  "If a target is not visible/reachable, choose a search/move/scout action or ask for help, not the same failing action.",
];

export const ACTION_PARAMETER_RULES = [
  "chat_public/chat_ai_private require speech.content or parameters.message; private chat may use recipientIds, subteamId, or leadersOnly.",
  "move_to, mine_block, and place_block require a concrete position or x/y/z.",
  "follow_player requires username/player/target; collect_item requires entityId/item/name.",
  "craft_item requires item/name/block; attack_entity requires entityId/username/name/target.",
  "flee requires position, entityId, username, or target; distance alone is not enough.",
];

export function buildPersonaSystemPrompt(_persona: StaticPersona): string {
  // Keep this stable across agents; persona details are rendered in STATIC_PERSONA context.
  return [
    "You are controlling a Minecraft studio agent at a high level.",
    "Maintain this static persona unless a director-approved major event says otherwise.",
    "Return compact JSON that matches the requested schema. Never include chain-of-thought.",
  ].filter(Boolean).join("\n");
}

export interface DecisionPromptInput {
  context: PromptContext;
  availableActions: string[];
  availableSkills?: string[];
  constraints?: string[];
}

export function buildDecisionPrompt(input: DecisionPromptInput): string {
  const constraints = input.constraints ?? DEFAULT_DECISION_CONSTRAINTS;
  return [
    "Make the next agent decision from the compact context.",
    "",
    "AVAILABLE_ACTIONS",
    input.availableActions.join(", "),
    input.availableSkills?.length
      ? [
          "",
          "AVAILABLE_SKILLS",
          input.availableSkills.join("\n"),
        ].join("\n")
      : undefined,
    "",
    "CONSTRAINTS",
    constraints.map((constraint) => `- ${constraint}`).join("\n"),
    "",
    "ACTION_PARAMETER_RULES",
    ACTION_PARAMETER_RULES.map((rule) => `- ${rule}`).join("\n"),
    "",
    "CONTEXT",
    input.context.contextText,
    "",
    "Return AgentDecision JSON with fields: intent, action, parameters, optional goal, optional skill, optional skillParams, optional expectedOutcome, optional recoveryIfFails, optional speech, confidence, reasoningSummary.",
    "Use skill only when one listed skill matches a multi-step goal. Skill selection is optional; action must still be one listed AVAILABLE_ACTIONS action.",
    "Speech is optional and should be short. Use visibility public or ai only.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

export interface PlanPromptInput {
  context: PromptContext;
  goal: string;
  trigger: string;
  availableActions: string[];
  availableSkills?: string[];
}

export function buildAgentPlanPrompt(input: PlanPromptInput): string {
  return [
    "Create or update a compact working plan for this Minecraft agent.",
    "The plan must be grounded in CURRENT_PLAN, PERCEPTION, inventory, EXECUTABLE_NOW, BLOCKED_USEFUL_ACTIONS, RECOVERY, and RECENT_ACTION_RESULTS.",
    "",
    `GOAL=${input.goal}`,
    `PLAN_UPDATE_TRIGGER=${input.trigger}`,
    "",
    "AVAILABLE_ACTIONS",
    input.availableActions.join(", "),
    input.availableSkills?.length
      ? [
          "",
          "AVAILABLE_SKILLS",
          input.availableSkills.join("\n"),
        ].join("\n")
      : undefined,
    "",
    "PLAN_RULES",
    "- Return 3 to 8 concise steps.",
    "- Exactly one step should be active unless all useful work is done or blocked.",
    "- Each step needs a concrete successCondition.",
    "- Each unfinished step should include nextAction from AVAILABLE_ACTIONS or skill from AVAILABLE_SKILLS.",
    "- Include neededItems or target only when known from inventory, perception, affordances, or recent failures.",
    "- If RECOVERY or a blocked current step is present, revise the next step to satisfy the blocker or choose a different target/action.",
    "- Do not invent distant targets, impossible inventory, or hidden world state.",
    "",
    "CONTEXT",
    input.context.contextText,
    "",
    "Return AgentTaskPlan JSON with fields: goal, currentStepId, steps, optional reasoningSummary.",
    "Each step has: id, description, status, successCondition, optional neededItems, optional target, optional blocker, optional nextAction, optional skill.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

export interface ReflectionPromptInput {
  context: PromptContext;
  majorEvent: string;
}

export function buildReflectionPrompt(input: ReflectionPromptInput): string {
  return [
    "Reflect on this major event and return only deltas for memory, goals, relationships, and emotional state.",
    "Do not rewrite the full static persona or identity.",
    "",
    input.context.contextText,
    "",
    "MAJOR_EVENT",
    input.majorEvent,
    "",
    "Return ReflectionResult JSON with changed relationships, newGoals, memorySummary, emotionalState, and reasoningSummary.",
  ].join("\n");
}

export interface LeaderSummaryPromptInput {
  context: PromptContext;
  plan: string;
  audienceAgentIds: string[];
}

export function buildLeaderSummaryPrompt(input: LeaderSummaryPromptInput): string {
  return [
    "Create one short actionable broadcast for the listed agents.",
    "Keep it under 240 characters. Include the immediate plan and who should act.",
    "",
    input.context.contextText,
    "",
    `AUDIENCE=${input.audienceAgentIds.join(", ")}`,
    `PLAN=${input.plan}`,
    "",
    "Return a concise message only, not analysis.",
  ].join("\n");
}

export function decisionToActionSummary(decision: AgentDecision): string {
  return `${decision.intent} -> ${decision.action}`;
}
