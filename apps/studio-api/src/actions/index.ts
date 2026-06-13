export * from "./basic";
export * from "./build";
export * from "./combat";
export * from "./crafting";
export * from "./farming";
export * from "./movement";
export * from "./registry";
export * from "./resource";
export * from "./types";

import { createChatAiPrivateAction, createChatPublicAction, createIdleAction } from "./basic";
import { createPlaceBlockAction } from "./build";
import { createAttackEntityAction } from "./combat";
import { createCraftItemAction } from "./crafting";
import { createHarvestCropAction, createPlantCropAction } from "./farming";
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
  registry.register(createHarvestCropAction());
  registry.register(createPlantCropAction());
  registry.register(createCraftItemAction());
  registry.register(createPlaceBlockAction());
  registry.register(createAttackEntityAction());
  return registry;
}
