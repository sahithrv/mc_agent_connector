# Decision Making Phase 7: Action Preferences And Role Templates

Date: 2026-06-13

## Summary

This phase changes configured `allowedActions` normalization so explicit config stays exact, while live agents treat those configured actions as role preferences instead of hard capability blocks.

## Implemented Changes

- Added `normalizeConfiguredAgentActions(actions)` in `apps/studio-api/src/agents/default-actions.ts`.
  - Trims action names.
  - Drops empty values.
  - Deduplicates without appending defaults.
- Added `defaultAgentActions()`.
  - Returns a defensive copy of the default action list.
  - Includes `chat_public`, `harvest_crop`, and `plant_crop` alongside the existing default action set.
- Kept `normalizeAgentActions()` as a compatibility alias for exact configured-action normalization.
- Updated config loading in `apps/studio-api/src/config/agents.ts`.
  - Missing `allowedActions` now gets `defaultAgentActions()`.
  - Explicit `allowedActions` arrays remain exact.
  - Empty arrays still reject config before startup.
- Updated director add/update handling in `apps/studio-api/src/director/routes.ts`.
  - New agents without `allowedActions` use role templates when the role matches.
  - Explicit action arrays remain exact.
  - Updates preserve current actions unless `allowedActions` is provided.
- Updated dashboard/runtime add-agent payload handling in `apps/studio-api/src/live/runtime.ts`.
  - Missing actions use role templates/defaults.
  - Explicit empty or malformed action arrays are rejected by returning no runtime agent from the payload parser.

## Role Templates

Added role action templates for:

- `farmer`
- `miner`
- `guard`
- `builder`
- `scout`

These templates are used as defaults for new session agents created through director/runtime paths. They are intentionally role-shaped preference sets, not the live execution capability set.

## Preference-Not-Block Behavior

To honor the requirement that bots should be able to do anything and merely prefer role-relevant actions:

- The persisted/session `allowedActions` value remains exact.
- The live runtime derives an internal capability-complete agent copy using `defaultAgentActions()` plus any configured actions.
- The original configured action list is retained in an LLM memory named `role-action-preferences`.
- The prompt tells the LLM to prefer those role actions but use any `AVAILABLE_ACTIONS` entry when it better advances the goal, recovers from failure, satisfies a blocker, or handles danger.

This means a config with only `["move_to", "chat_ai_private"]` still loads and serializes exactly as those two actions, but the live bot is not prevented from fleeing, mining, collecting, crafting, or placing when those actions are useful and executable.

## Tests Added Or Updated

- Added `apps/studio-api/src/agents/default-actions.test.ts`.
- Updated config tests to cover:
  - exact configured actions;
  - omitted `allowedActions` using defaults;
  - no automatic `mine_block` addition for explicit two-action configs.
- Updated director tests to cover exact configured add-agent actions.
- Added a live runtime regression test proving an agent whose configured actions omit `flee` can still execute `flee` when injured near a hostile.

## Verification

- `npm run lint` passed.
- First sandboxed `npm run test` failed during Vite/esbuild startup with `spawn EPERM`.
- Reran `npm run test` outside the sandbox; it passed:
  - root build passed;
  - API node tests: 167 passed;
  - Studio web Vitest tests: 16 files passed, 31 tests passed.
