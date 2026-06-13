# Decision Making Phase 6: Crop Actions

Date: 2026-06-13

## Summary

This phase implements concrete Minecraft crop actions so farmer routines can harvest and plant crops through the normal action registry instead of being rejected as unknown actions.

## Implemented Changes

- Added `apps/studio-api/src/actions/farming.ts`.
- Added `createHarvestCropAction()`:
  - requires `bot.blockAt` and `bot.dig`;
  - requires a target position;
  - validates the target is a supported mature crop (`wheat`, `carrots`, `potatoes`, or `beetroots`);
  - validates crop maturity from block properties, metadata, or explicit test maturity;
  - digs the mature crop;
  - optionally replants on farmland below the crop when `replant: true`, planting support exists, and a matching seed item is available.
- Added `createPlantCropAction()`:
  - requires `bot.blockAt`, `bot.equip`, and `bot.placeBlock`;
  - requires a target position;
  - accepts either a farmland target or the air block directly above farmland;
  - requires an available seed item, selecting a requested seed/crop when provided or the first supported seed in inventory;
  - validates the farmland target is within 5 blocks;
  - equips the seed and places it on the top face of the farmland.
- Registered both actions in `createDefaultActionRegistry()`.
- Exported the farming action module from `apps/studio-api/src/actions/index.ts`.
- Added `harvest_crop` and `plant_crop` to `DEFAULT_AGENT_ACTIONS` so normalized agent configs authorize routine-produced farmer intents.

## Schema And Intent Decision

The farming actions remain routine-only for this phase.

I did not add `harvest_crop` or `plant_crop` to `AgentDecisionActionSchema`, `INTENT_ACTION_MAP`, or decision contract validation. The current farmer routine already grounds these actions with concrete visible crop/farmland positions from perception, while the LLM affordance layer does not yet expose crop-specific executable targets. Keeping them out of the LLM schema prevents ungrounded LLM crop actions while still allowing `RoutineActionIntent` dispatch through the registry.

## Tests Added Or Updated

- Added `apps/studio-api/src/actions/farming.test.ts`.
- Covered default registry registration for `harvest_crop` and `plant_crop`.
- Covered mature crop harvest with replanting.
- Covered immature crop rejection before digging.
- Covered planting on nearby farmland with automatic seed selection.
- Covered planting when the target is the air block above farmland.
- Covered rejection when planting target distance exceeds 5 blocks.
- Updated action test helpers to authorize farming actions in registry tests.

## Verification

- `npm run lint` passed.
- First sandboxed `npm run test` attempt failed during the web build with Vite/esbuild `spawn EPERM`.
- Reran `npm run test` with escalation; it passed:
  - root build passed;
  - API node tests: 164 passed;
  - Studio web Vitest tests: 16 files passed, 31 tests passed.
