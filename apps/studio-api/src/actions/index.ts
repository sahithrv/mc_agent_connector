export * from "./basic";
export * from "./combat";
export * from "./movement";
export * from "./registry";
export * from "./resource";
export * from "./types";

import { createChatAiPrivateAction, createChatPublicAction, createIdleAction } from "./basic";
import { createAttackEntityAction } from "./combat";
import { createFleeAction, createFollowPlayerAction, createMoveToAction } from "./movement";
import { ActionRegistry } from "./registry";
import { createCollectItemAction, createMineBlockAction } from "./resource";

export function createDefaultActionRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  registry.register(createIdleAction());
  registry.register(createChatPublicAction());
  registry.register(createChatAiPrivateAction());
  registry.register(createMoveToAction());
  registry.register(createFollowPlayerAction());
  registry.register(createFleeAction());
  registry.register(createCollectItemAction());
  registry.register(createMineBlockAction());
  registry.register(createAttackEntityAction());
  return registry;
}
