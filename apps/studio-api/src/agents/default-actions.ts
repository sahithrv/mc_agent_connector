export const DEFAULT_AGENT_ACTIONS = [
  "idle",
  "continue_routine",
  "chat_public",
  "chat_ai_private",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "harvest_crop",
  "plant_crop",
  "craft_item",
  "place_block",
  "attack_entity",
] as const;

const ROLE_AGENT_ACTION_TEMPLATES = {
  farmer: [
    "idle",
    "continue_routine",
    "chat_ai_private",
    "chat_public",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "harvest_crop",
    "plant_crop",
    "craft_item",
    "place_block",
  ],
  miner: [
    "idle",
    "continue_routine",
    "chat_ai_private",
    "chat_public",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "mine_block",
    "craft_item",
    "place_block",
  ],
  guard: [
    "idle",
    "continue_routine",
    "chat_ai_private",
    "chat_public",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "craft_item",
    "place_block",
    "attack_entity",
  ],
  builder: [
    "idle",
    "continue_routine",
    "chat_ai_private",
    "chat_public",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "mine_block",
    "craft_item",
    "place_block",
  ],
  scout: [
    "idle",
    "continue_routine",
    "chat_ai_private",
    "chat_public",
    "move_to",
    "follow_player",
    "flee",
    "collect_item",
    "mine_block",
  ],
} as const;

export type AgentRoleActionTemplate = keyof typeof ROLE_AGENT_ACTION_TEMPLATES;

export function normalizeAgentActions(actions: readonly string[]): string[] {
  return normalizeConfiguredAgentActions(actions);
}

export function normalizeConfiguredAgentActions(actions: readonly string[]): string[] {
  return [...new Set(actions.map((action) => action.trim()).filter(Boolean))];
}

export function defaultAgentActions(): string[] {
  return [...DEFAULT_AGENT_ACTIONS];
}

export function defaultAgentActionsForRole(role: string | undefined): string[] {
  const roleKey = roleTemplateKey(role);
  return roleKey
    ? normalizeConfiguredAgentActions(ROLE_AGENT_ACTION_TEMPLATES[roleKey])
    : defaultAgentActions();
}

function roleTemplateKey(role: string | undefined): AgentRoleActionTemplate | undefined {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  for (const key of Object.keys(ROLE_AGENT_ACTION_TEMPLATES) as AgentRoleActionTemplate[]) {
    if (normalized === key || normalized.includes(key)) {
      return key;
    }
  }
  return undefined;
}
