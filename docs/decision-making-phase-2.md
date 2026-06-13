# Minecraft Agent Decision-Making Phase 2

## Implemented

- Added `ActionResultContext` to the prompt context types.
- Added a new `RECENT_ACTION_RESULTS` section to decision prompt context rendering.
- The section renders the most recent action outcomes as compact lines, for example:
  - `mine_block target=iron_ore@12,64,-9 ok=false error="missing valid tool for block: iron_ore"`
  - `craft_item target=wooden_pickaxe ok=false error="no craftable recipe for wooden_pickaxe"`
  - `move_to target=30,64,10 ok=false error="No path to goal"`
- Rendering is capped to the last 8 action results and remains part of the existing `maxContextChars` budget.
- `AgentDecisionService` now accepts `recentActionResults` and passes them into `buildPromptContext`.
- `LiveDecisionPlanner.plan()` now passes `actionHistory.recentForAgent(agent.id, 8)` into each LLM decision request.

## Failure Feedback Constraints

Added prompt constraints that tell the model how to react to recent failures:

- Do not repeat the same failed action-target pair unless the blocker has changed.
- If a recent action failed due to missing tool/material, choose an action that satisfies that precondition.
- Do not choose `idle` while any physical action or craftable precondition advances the active goal.
- If a target is not visible/reachable, choose a search/move/scout action or ask for help, not the same failing action.

These constraints were added to both the default decision constraints and the live planner constraints.

## Verification

- Added prompt rendering coverage for `RECENT_ACTION_RESULTS`, including near-verbatim failure reasons and target formatting.
- Added decision-service coverage proving recent action results appear in the actual decision prompt.
- Verified the context still respects the configured character budget.

Checks run:

- `npm run lint` passed.
- `npm run test` passed with 155 API tests and 31 web tests.
