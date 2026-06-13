# Decision-Making Phase 11 Report

## Scope

Implemented Task 11.1 and Task 11.2 from the Minecraft LLM agent decision-making plan:

- Rotate planning slot assignment across agents when planning slots are limited.
- Add reusable live progress signal extraction and use it for stuck detection and plan-step updates.

## Task 11.1: Round-Robin Planning Slots

Updated the scheduler so queued planning work no longer always starts from the lowest sorted agent id.

Changes:

- Added `planningCursor` to `AgentScheduler`.
- Moved queued planning startup into `startQueuedPlanning`.
- Default behavior now rotates the planning scan start after each started planner.
- Added optional `roundRobinPlanning?: boolean` on `SchedulerConfig`; setting it to `false` preserves fixed agent-id-order planning.
- Added a deterministic scheduler test proving one planning slot starts agents in rotating order across ticks.

Primary files:

- `apps/studio-api/src/scheduler/scheduler.ts`
- `apps/studio-api/src/scheduler/types.ts`
- `apps/studio-api/src/scheduler/scheduler.test.ts`

## Task 11.2: Progress Signal Extraction

Added `apps/studio-api/src/live/progress.ts`.

The helper builds normalized progress snapshots and extracts compact progress signals for:

- Inventory changes.
- Position changes.
- Health and food changes.
- Placed, mined, collected, and crafted action counters.
- Team goal progress counter changes.

The progress signal is attached to live action result data as:

- `progressSignal`
- `progressChanged`
- `progressChanges`
- `progressSignature`
- `progressDelta` when non-empty

Runtime wiring:

- Live perception snapshots now seed per-agent progress baselines.
- Action results are enriched with progress signals before action history, skills, competitive coordination, and task state consume them.
- Team goal progress counters ignore explicit baseline-backed no-progress results.
- Stuck detection reads `progressSignal.afterSignature` and flags repeated successful same-target actions when the signature does not change.
- Task state no longer completes progress-sensitive plan steps when a successful action explicitly reports no measurable progress; repeated no-progress results trigger `blocked_repeatedly`.
- Mine affordance positions are compacted before dispatch so optional `world` is omitted when unknown, keeping action params deterministic.

Primary files:

- `apps/studio-api/src/live/progress.ts`
- `apps/studio-api/src/live/runtime.ts`
- `apps/studio-api/src/live/stuck-detector.ts`
- `apps/studio-api/src/live/task-state.ts`
- `apps/studio-api/src/live/team-goal-controller.ts`

## Tests Added

- `apps/studio-api/src/live/progress.test.ts`
- Scheduler round-robin planning test in `apps/studio-api/src/scheduler/scheduler.test.ts`
- No-progress repeated success stuck detection test in `apps/studio-api/src/live/stuck-detector.test.ts`
- No-progress plan-step blocking test in `apps/studio-api/src/live/task-state.test.ts`

## Verification

Commands run:

- `npm run lint`
- `npm run test`

Result:

- `npm run lint` passed.
- `npm run test` passed after rerunning with sandbox escalation because the sandboxed attempt failed during the Vite/esbuild service spawn with `spawn EPERM`.
- Final full test run covered 182 API tests and 31 web tests.
