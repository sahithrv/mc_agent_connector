export const DEFAULT_AGENT_ACTIONS = [
  "idle",
  "continue_routine",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "craft_item",
  "place_block",
  "attack_entity",
  "chat_ai_private",
] as const;

export function normalizeAgentActions(actions: readonly string[]): string[] {
  return [...new Set([...actions, ...DEFAULT_AGENT_ACTIONS])];
}
