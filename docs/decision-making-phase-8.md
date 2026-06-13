# Decision-Making Phase 8: Skill Layer

## Scope

Implemented Task 8.1 and Task 8.2 for planner-owned skill selection without adding a `run_skill` primitive action.

## What Changed

- Added `apps/studio-api/src/skills/types.ts` with the requested `SkillRequest`, `SkillStepResult`, and `RegisteredSkill` interfaces, plus execution context for per-agent state and runtime perception.
- Added `apps/studio-api/src/skills/registry.ts` with a `SkillRegistry` that:
  - Registers `gather_wood`, `craft_basic_tools`, `gather_stone`, `build_simple_shelter`, `follow_leader`, `farm_cycle`, and `hunt_target`.
  - Expands skills into existing primitive `RoutineActionIntent` actions such as `mine_block`, `craft_item`, `place_block`, `follow_player`, `harvest_crop`, `plant_crop`, and `attack_entity`.
  - Maintains active skill execution state per agent and updates progress from `action.result` events.
- Extended `AgentDecision` with optional planner fields:
  - `goal`
  - `skill`
  - `skillParams`
  - `expectedOutcome`
  - `recoveryIfFails`
- Updated decision prompts to advertise available skills while keeping skill selection optional and requiring a valid existing primitive action.
- Wired `LiveDecisionPlanner` to:
  - Continue active skills before asking the LLM again.
  - Start a skill when the LLM returns optional `skill` metadata.
  - Trace skill-expanded actions with `source=skill`.
  - Queue follow-up planning after skill-owned action results so multi-tick skills can continue.
- Kept existing `AgentDecision` behavior backward compatible; old decisions with only `intent`, `action`, `parameters`, `confidence`, and `reasoningSummary` still parse and execute normally.

## Tests Added

- `apps/studio-api/src/skills/registry.test.ts`
  - Verifies `gather_wood` expands to `mine_block` and completes from per-agent state after an action result.
  - Verifies `follow_leader` continues across action-result ticks.
- Added schema coverage for optional planner skill fields.
- Added decision-service prompt coverage for `AVAILABLE_SKILLS`.

## Verification

- `npm run lint` passed.
- `npm run test` passed end to end.

Note: the first sandboxed `npm run test` attempt failed with `spawn EPERM` while Vite/esbuild loaded the web config. The successful verification run was executed outside the sandbox after approval.
