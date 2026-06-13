# Decision-Making Phase 4 Report

## Scope

Implemented Task 4.1 and Task 4.2 for live Minecraft LLM agent decision grounding:

- Build concrete action affordances from visible world state, inventory, task text, and recent failures.
- Render executable and blocked-useful actions into the decision prompt.
- Add prompt pressure to prefer executable actions that advance the active goal.

## Task 4.1: Live Action Affordances

Added `apps/studio-api/src/live/affordances.ts`.

The new `buildAffordances(...)` function produces `ActionAffordance[]` entries with:

- `action`, `params`, `score`, and `reason`.
- Optional `advancesGoal`, `blocked`, `blockedReason`, and `targetKey`.

Implemented affordance sources:

- Visible safe mineable blocks within range.
- Visible useful dropped resources and food items.
- Crafting affordances from current inventory, including wood-to-tools chains.
- Block placement targets near the bot when inventory and adjacent support blocks allow placement.
- Visible player follow targets.
- Safe hostile attack targets and director-approved threatening player targets.
- Patrol/scout `move_to` targets.
- Blocked useful guidance, including ore mining blocked by missing pickaxes and craft preconditions such as missing cobblestone or sticks.

The live planner now builds affordances before LLM decisions in `apps/studio-api/src/live/runtime.ts` and passes recent failures into the builder so failed tool/material blockers can be converted into precondition guidance.

## Task 4.2: Prompt Rendering

Changed prompt context and decision service wiring:

- `apps/studio-api/src/llm/prompts/types.ts`
- `apps/studio-api/src/llm/prompts/context.ts`
- `apps/studio-api/src/llm/prompts/templates.ts`
- `apps/studio-api/src/llm/decisions/service.ts`

New prompt sections are rendered when affordances exist:

```text
EXECUTABLE_NOW
- craft_item oak_planks x4 score=0.95 reason="logs in inventory; needed for tools"

BLOCKED_USEFUL_ACTIONS
- mine_block iron_ore blocked="missing stone_pickaxe"
```

The default decision constraints and the live planner constraints now include:

- Prefer `EXECUTABLE_NOW` actions that advance the goal.

## Tests Added

Added `apps/studio-api/src/live/affordances.test.ts` with coverage for:

- Visible stone producing an executable `mine_block` affordance.
- Logs in inventory producing craft guidance for planks, sticks, crafting table, and wooden pickaxe.
- Visible iron ore without the required tool producing a blocked `mine_block` and blocked `stone_pickaxe` craft precondition guidance.

Updated `apps/studio-api/src/llm/prompts/prompts.test.ts` with coverage proving:

- `EXECUTABLE_NOW` renders executable affordances in the prompt context.
- `BLOCKED_USEFUL_ACTIONS` renders blocked affordances.
- The decision prompt includes the new constraint.

## Verification

Commands run:

- `npm --workspace @mc-ai-video/studio-api run build` - passed.
- `node apps/studio-api/dist/test-runner.js` - passed with 162 API tests.
- `npm run lint` - passed.
- `npm run test` - first sandboxed run failed in the web Vite build with esbuild `spawn EPERM`; rerun outside the sandbox passed.

Final passing result:

- API tests: 162 passed.
- Web tests: 31 passed.
