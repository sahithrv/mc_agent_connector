import type { AgentConfig } from "@mc-ai-video/contracts";

import { AgentDecisionActionSchema, type AgentDecision } from "../schemas/agent-decision";

export type HighLevelIntent =
  | "wait"
  | "continue_work"
  | "speak_publicly"
  | "speak_privately"
  | "follow_ally"
  | "retreat"
  | "gather_item"
  | "mine_resource"
  | "defend_from_hostile"
  | "ask_for_help";

export interface IntentActionMapping {
  intent: HighLevelIntent;
  action: AgentDecision["action"];
  routineId?: string;
  description: string;
  parameterHints: string[];
}

export const INTENT_ACTION_MAP: readonly IntentActionMapping[] = [
  {
    intent: "wait",
    action: "idle",
    description: "Pause briefly, watch, or avoid unnecessary action.",
    parameterHints: ["durationMs"],
  },
  {
    intent: "continue_work",
    action: "continue_routine",
    description: "Continue the agent's assigned deterministic routine.",
    parameterHints: ["routineId"],
  },
  {
    intent: "speak_publicly",
    action: "chat_public",
    description: "Say a short public message.",
    parameterHints: ["message"],
  },
  {
    intent: "speak_privately",
    action: "chat_ai_private",
    description: "Send a short AI-private message to selected agents.",
    parameterHints: ["recipientIds", "message", "topic"],
  },
  {
    intent: "follow_ally",
    action: "follow_player",
    description: "Follow a visible player or agent at a safe range.",
    parameterHints: ["username", "range"],
  },
  {
    intent: "retreat",
    action: "flee",
    description: "Move away from danger toward a safer position.",
    parameterHints: ["entityId", "username", "position", "distance"],
  },
  {
    intent: "gather_item",
    action: "collect_item",
    description: "Pick up a visible useful item.",
    parameterHints: ["entityId", "item"],
  },
  {
    intent: "mine_resource",
    action: "mine_block",
    description: "Mine a visible safe block needed for the goal.",
    parameterHints: ["position", "block"],
  },
  {
    intent: "defend_from_hostile",
    action: "attack_entity",
    description: "Attack an allowed hostile entity when defense is necessary.",
    parameterHints: ["entityId", "name"],
  },
  {
    intent: "ask_for_help",
    action: "chat_ai_private",
    description: "Ask allies for help when blocked or threatened.",
    parameterHints: ["recipientIds", "message", "topic"],
  },
];

const SCHEMA_ACTIONS = new Set<string>(AgentDecisionActionSchema.options);

export function allowedDecisionActionsForAgent(
  agent: Pick<AgentConfig, "allowedActions" | "routine">,
): AgentDecision["action"][] {
  const actions = new Set<AgentDecision["action"]>(["idle"]);
  if (agent.routine) {
    actions.add("continue_routine");
  }
  for (const action of agent.allowedActions) {
    if (SCHEMA_ACTIONS.has(action)) {
      actions.add(action as AgentDecision["action"]);
    }
  }
  return [...actions];
}

export function promptActionDescriptions(actions: readonly string[]): string[] {
  const allowed = new Set(actions);
  return INTENT_ACTION_MAP
    .filter((mapping) => allowed.has(mapping.action))
    .map((mapping) =>
      `${mapping.action}: ${mapping.description} Params: ${mapping.parameterHints.join(", ") || "none"}`,
    );
}

export function isAllowedDecisionAction(
  action: string,
  availableActions: readonly string[],
): action is AgentDecision["action"] {
  return SCHEMA_ACTIONS.has(action) && availableActions.includes(action);
}
