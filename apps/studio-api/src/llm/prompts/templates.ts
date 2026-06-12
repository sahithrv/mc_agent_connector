import type { AgentDecision } from "../schemas/agent-decision";
import type { PromptContext, StaticPersona } from "./types";

export const DEFAULT_DECISION_CONSTRAINTS = [
  "Choose exactly one high-level action.",
  "Use only the listed actions and provide only parameters needed for that action.",
  "Do not expose hidden reasoning; keep reasoningSummary short.",
  "Do not change static identity, role, team, or core persona during a decision.",
  "Avoid unsafe mining, griefing, friendly fire, and attacks on players unless explicitly allowed by scenario constraints.",
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
  constraints?: string[];
}

export function buildDecisionPrompt(input: DecisionPromptInput): string {
  const constraints = input.constraints ?? DEFAULT_DECISION_CONSTRAINTS;
  return [
    "Make the next agent decision from the compact context.",
    "",
    "AVAILABLE_ACTIONS",
    input.availableActions.join(", "),
    "",
    "CONSTRAINTS",
    constraints.map((constraint) => `- ${constraint}`).join("\n"),
    "",
    "CONTEXT",
    input.context.contextText,
    "",
    "Return AgentDecision JSON with fields: intent, action, parameters, optional speech, confidence, reasoningSummary.",
    "Speech is optional and should be short. Use visibility public or ai only.",
  ].join("\n");
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
