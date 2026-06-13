# Decision-Making Phase 9: Per-Agent Task Plans

## Scope

Implemented Task 9.1 and Task 9.2 for persistent per-agent task state and plan generation/update prompts.

## What Changed

- Added `apps/studio-api/src/live/task-state.ts` with:
  - `PlanStep` and `AgentTaskState` interfaces.
  - `AgentTaskStateStore` for per-agent goal/plan persistence across scheduler ticks.
  - Goal reset handling, compact prompt-state projection, active-step advancement, blocked-step recording, and repeated-block detection.
- Added `CURRENT_PLAN` prompt context rendering in `apps/studio-api/src/llm/prompts/context.ts`.
- Extended decision prompt inputs so `AgentDecisionService` can include current task state in the same context as perception, affordances, recovery, and recent action results.
- Added `apps/studio-api/src/llm/schemas/agent-plan.ts` and `apps/studio-api/src/llm/decisions/plan-service.ts`.
  - `AgentPlanService` requests `AgentTaskPlan` JSON with 3-8 concise steps.
  - Plan steps include success conditions plus optional `neededItems`, `target`, `nextAction`, and `skill`.
  - Provider failures fall back to an affordance/recovery-grounded local plan.
- Wired `LiveAgentRuntime` to:
  - Own and expose `taskState`.
  - Reset task state on director agent/subteam goals and actionable director/team instructions.
  - Update task state from every `action.result`.
  - Generate/update plans only when the goal changes, the current plan is empty, stuck recovery triggers, or the current step is blocked repeatedly.
  - Reuse existing plans on later planning ticks instead of regenerating every tick.

## Tests Added

- `apps/studio-api/src/live/task-state.test.ts`
  - Verifies goal reset, step advancement after success, blocked-step updates after failure, repeated-block trigger behavior, and compact prompt projection.
- `apps/studio-api/src/llm/decisions/decisions.test.ts`
  - Verifies `CURRENT_PLAN` reaches the decision prompt.
  - Verifies `AgentPlanService` requests grounded `AgentTaskPlan` output.
  - Verifies provider-error fallback plans.
- `apps/studio-api/src/llm/prompts/prompts.test.ts`
  - Verifies compact `CURRENT_PLAN` rendering.
- `apps/studio-api/src/live/runtime.test.ts`
  - Verifies live runtime generates a task plan once and reuses it on a later planning tick.

## Verification

- `npm run lint` passed.
- `npm run test` passed end to end outside the sandbox.

Note: the first sandboxed `npm run test` attempt failed with `spawn EPERM` while Vite/esbuild loaded the web config. The successful verification run used the same command outside the sandbox after approval.
