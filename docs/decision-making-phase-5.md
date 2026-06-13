# Decision Making Phase 5: Stuck Recovery

Date: 2026-06-13

## Summary

This phase adds stable action-target keys, stuck detection, and recovery-aware LLM planning for live Minecraft agents. The main behavior change is that repeated failures, repeated idles, repeated no-progress actions, and false-positive movement successes now become explicit recovery context before the next LLM decision.

## Implemented Changes

- Added `apps/studio-api/src/live/action-target-key.ts`.
- Added stable `targetKeyForAction(action, params)` generation for `mine_block`, `place_block`, `collect_item`, `craft_item`, `move_to`, `follow_player`, and `attack_entity`.
- Normalized equivalent parameter shapes, including nested `position` and direct `x/y/z`.
- Wired `ActionHistoryStore` to compute action-aware target keys while preserving explicit target keys for custom/unknown actions.
- Updated decision tracing and affordance generation to use the same key format.
- Added `apps/studio-api/src/live/stuck-detector.ts`.
- Added `analyzeStuck(agentId, history, currentState)` with detection for:
  - same failed action-target pair twice in 60 seconds, blocked for 30 seconds;
  - repeated successful action-target pairs without measurable inventory, position, or progress change;
  - three consecutive idles while an active goal exists;
  - `move_to` success while still away from target or without position movement;
  - repeated `continue_routine` without measurable progress.
- Integrated stuck analysis into `LiveDecisionPlanner.plan()` before the LLM call.
- Demoted blocked affordances into blocked prompt guidance instead of executable suggestions.
- Added a `RECOVERY` prompt section with reason, blocked target keys, and a recovery hint.
- Added recovery-specific constraints telling the LLM to choose a different action/target or satisfy the blocker.
- Traced stuck LLM decisions with decision source `stuck_recovery`.

## Tests Added Or Updated

- Added target-key unit tests for stable action-specific keys.
- Added stuck-detector tests for repeated failed mining, repeated idle, and repeated `move_to`.
- Added prompt and decision-service tests verifying `RECOVERY` appears in LLM prompts.
- Updated history/runtime expectations for the new action-aware target key format.

## Verification

- `npm run lint` passed.
- `npm run test` passed:
  - API node tests: 164 passed.
  - Studio web Vitest tests: 16 files passed, 31 tests passed.

Note: the first sandboxed test attempt failed with Vite/esbuild `spawn EPERM`; rerunning outside the sandbox completed successfully.
