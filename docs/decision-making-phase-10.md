# Decision Making Phase 10: Feasibility Validation and Repair

## Summary

Added a live world feasibility layer for LLM-derived Minecraft actions. The runtime now rejects actions that are known to be bad before they reach scheduler execution, then either uses a goal-advancing executable affordance, asks the LLM for one repaired decision, or falls back safely.

## Changes

- Added `apps/studio-api/src/live/action-feasibility.ts`.
- Added `validateIntentFeasibility(...)` with `FeasibilityResult`.
- Checks exact stuck-detector blocked target keys before action dispatch.
- Validates physical action feasibility against current bot/perception state:
  - `mine_block`: visible target, range, unsafe block guard, diggability, and tool requirements.
  - `collect_item`: visible dropped item, range, inventory space, and collect plugin availability.
  - `craft_item`: craftability through `recipesFor` or blocked precondition reasons from affordances.
  - `place_block`: nearby target, placeable inventory item, empty target block, and adjacent reference block.
  - `follow_player`: visible non-self player and pathfinder availability.
  - `attack_entity`: visible target, attack capability, self/protected-target guard.
- Converts high-scoring, non-blocked, goal-advancing affordances into executable alternative intents.
- Integrated feasibility validation into `LiveDecisionPlanner` after LLM decision-to-intent conversion and before returning the action to the scheduler.
- Added `AgentDecisionService.repairRejectedDecision(...)` so runtime can send one feasibility repair prompt using the existing decision prompt and contract validation.
- Added `AgentDecisionService.fallbackForRejection(...)` for consistent fallback generation after failed feasibility repair.
- Decision traces now mark feasibility rejections with `rejected=true` and include the infeasibility reason.

## Behavior

When an LLM returns an infeasible action:

1. The action is rejected before scheduler execution.
2. If a high-scoring affordance advances the same goal, that affordance is executed instead.
3. If no alternative qualifies, the runtime sends one repair prompt with the infeasibility reason.
4. If repair is unavailable or also infeasible, the runtime falls back, and if that fallback is also infeasible it idles with a clear reason.

## Tests Added

- `apps/studio-api/src/live/action-feasibility.test.ts`
  - blocked target rejection and alternative generation
  - invalid mining tool rejection
  - craft precondition rejection with alternative
  - invalid placement target rejection
  - invisible follow target rejection
- `apps/studio-api/src/live/runtime.test.ts`
  - infeasible LLM mine target is replaced by a feasible goal-advancing mine affordance
  - one repair prompt is sent when no feasible alternative qualifies

## Verification

- `npm run lint` passed.
- `npm run test` passed after rerunning outside the sandbox because the sandbox blocked Vite/esbuild process spawn with `EPERM`.
