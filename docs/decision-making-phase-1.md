# Minecraft Agent Decision-Making Phase 1

## Implemented

- Added structured decision tracing in `apps/studio-api/src/live/decision-trace.ts`.
- Added `DecisionSource` and `DecisionTrace` with source, action, target key, reason, fallback, rejected, and timestamp fields.
- `LiveDecisionPlanner.plan()` now emits a `game.event` with type `decision.trace` and visibility `ai` for each returned planner decision.
- Deterministic planner paths now trace why the LLM was not called:
  - `survival`
  - `opportunistic_collect`
  - `competitive`
  - `team_goal`
- LLM planner paths now trace whether fallback or repair was used:
  - normal decisions use `llm`
  - provider fallback uses `fallback`
  - rejected LLM output repaired by fallback uses `llm_repair`
- Returned planner actions are annotated with trace-derived `source` and `targetKey` metadata before the scheduler creates an action request.

## Action Result History

- Added `ActionHistoryStore` in `apps/studio-api/src/live/action-history.ts`.
- The store keeps the most recent 20 action results per agent and exposes `recentForAgent(agentId)`.
- Action history entries preserve:
  - action
  - compacted params
  - ok/error
  - data
  - startedAt/completedAt
  - targetKey
  - requestedBy
  - source when available
- `createLiveAgentRuntime()` now owns an `actionHistory` store and records every `action.result` event through the existing subscription.
- `ActionRequest` and `ActionResult` now carry optional `source`, `targetKey`, `params`, and `requestedBy` metadata so failures keep enough context for recovery, including messages like `missing valid tool for block: iron_ore`.

## Verification

- Added coverage for `ActionHistoryStore` retention and metadata preservation.
- Added runtime coverage for AI-visible `decision.trace` events from deterministic competitive planning.
- Added runtime coverage that `action.result` events are recorded into live action history.

Checks run:

- `npm run lint` passed.
- `npm run test` passed after rerunning outside the sandbox because the first sandboxed run failed with Vite/esbuild `spawn EPERM`.
