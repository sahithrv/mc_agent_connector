import type {
  ActionRequest,
  AgentConfig,
  JsonValue,
} from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";

const ALL_ACTIONS = [
  "idle",
  "chat_public",
  "chat_ai_private",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "attack_entity",
];

export function actionRequest(
  action: string,
  params: Record<string, JsonValue> = {},
  timeoutMs?: number,
): ActionRequest {
  return {
    id: `${action}-request`,
    agentId: "agent-a",
    action,
    params,
    timeoutMs,
    createdAt: "2026-06-10T00:00:00.000Z",
  };
}

export function fakeBot(overrides: Partial<BotHandle> = {}): BotHandle {
  return {
    username: "AdaBot",
    health: 20,
    food: 20,
    entity: {
      id: "self",
      type: "player",
      username: "AdaBot",
      position: { x: 0, y: 64, z: 0 },
    },
    entities: {},
    inventory: {
      items: () => [],
      emptySlotCount: () => 1,
    },
    on() {
      return this;
    },
    chat() {},
    quit() {},
    ...overrides,
  };
}

export function fakeAgent(): AgentConfig {
  return {
    id: "agent-a",
    name: "Ada",
    account: {
      username: "AdaBot",
      auth: "offline",
    },
    role: "guard",
    team: "blue",
    mode: "routine",
    allowedActions: ALL_ACTIONS,
    providerRef: "local",
  };
}
