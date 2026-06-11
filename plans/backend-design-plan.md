# Backend Design Plan

## V1 Target

Build a local Java Edition Agent Studio backend that can start 20+ Mineflayer agents, run only a bounded subset through LLM planning, expose safe action execution, persist events, and support director controls for testing tonight.

## Pushback

Do not make the Paper plugin mandatory for the first backend boot. Build app-level private AI chat first, then add the Paper bridge. True 20-agent autonomy today is risky; ship 20 connected agents with scheduler-limited LLM reasoning and deterministic routines.

## Backend Rules

- Keep each file under 250 lines when practical.
- Use TypeScript everywhere.
- Export typed contracts from small `types.ts` files.
- Add short comments on scheduler, event ordering, and permission boundaries.
- Do not let LLM code import Mineflayer directly.
- Do not let Mineflayer code call provider SDKs directly.

## Proposed Structure

```text
apps/studio-api/
  src/http/
  src/ws/
  src/config/
  src/db/
  src/events/
  src/director/
  src/chat/
  src/agents/
  src/bots/
  src/actions/
  src/scheduler/
  src/memory/
  src/server/
packages/contracts/
packages/minecraft-plugin/
```

## Core Contracts

```ts
type AgentMode = "paused" | "routine" | "planning" | "acting" | "failed";
type Visibility = "ai" | "human-team" | "recorder" | "public";
type EventSeverity = 1 | 2 | 3 | 4 | 5;
```

## PR Slices

### B01 Repo scaffold
Create npm workspace, TypeScript config, lint script, test script, and empty app/package folders.
Acceptance: `npm install`, `npm run build`, and `npm test` work.

### B02 Contracts package
Create `packages/contracts` with shared `AgentConfig`, `GameEvent`, `AiChatMessage`, `ActionRequest`, `ActionResult`.
Acceptance: backend imports contracts without circular imports.

### B03 Backend app shell
Create `apps/studio-api` with Fastify server, `/healthz`, structured logger, and env loader.
Acceptance: server starts and returns `{ ok: true }`.

### B04 Runtime config loader
Load `config/studio.config.json` with server host, port, tick rates, DB path, and max LLM concurrency.
Acceptance: invalid config returns readable startup error.

### B05 Agent config loader
Load `config/agents/*.json` and validate names, accounts, roles, allowed actions, and provider refs.
Acceptance: bad agent config is rejected before server start.

### B06 SQLite connection
Add SQLite client and migration runner.
Acceptance: DB file is created and migrations run once.

### B07 Event table
Create `events` table with id, type, actor, target, location, severity, payload, timestamp.
Acceptance: insert/list event repository tests pass.

### B08 Agent state table
Create `agent_state` table for mode, role, current task, health snapshot, last seen position, updated_at.
Acceptance: upsert and fetch tests pass.

### B09 Relationship table
Create `relationships` table for agent_id, target_id, trust, loyalty, fear, tags.
Acceptance: relationship update tests pass.

### B10 Memory table
Create `memories` table for agent_id, kind, summary, event_id, importance, created_at.
Acceptance: recent and important memory query tests pass.

### B11 Chat table
Create `ai_chat_messages` table with sender, recipients, topic, urgency, visibility, content, timestamp.
Acceptance: list by viewer role filters correctly.

### B12 Event bus
Add in-process typed event bus for game, chat, agent-state, director, and action-result events.
Acceptance: subscribers receive typed payloads in tests.

### B13 WebSocket hub
Add WebSocket endpoint for dashboard state streams.
Acceptance: client receives event and chat messages.

### B14 Director HTTP API
Add endpoints for pause/resume agent, pause/resume all, inject event, send AI chat, mark clip.
Acceptance: endpoints validate input and emit events.

### B15 Agent registry
Create registry that owns loaded configs, runtime state, and bot references.
Acceptance: can register, fetch, list, and update agent mode.

### B16 Mineflayer bot factory
Create bot factory for local offline Java server with host, port, username, version optional.
Acceptance: factory can be mocked in tests.

### B17 Bot lifecycle manager
Add connect, disconnect, reconnect, and failed state transitions.
Acceptance: lifecycle tests cover spawn, kicked, error, end.

### B18 Perception snapshot
Build compact snapshot from bot health, food, inventory, nearby players, mobs, position, recent events.
Acceptance: snapshot excludes raw large Mineflayer objects.

### B19 Action registry
Create action registry with `canRun`, `run`, timeout, risk level, and result shape.
Acceptance: unknown action is rejected.

### B20 Basic action: idle
Implement `idle` with duration limit.
Acceptance: returns success after duration.

### B21 Basic action: chat public
Implement `chat_public` through Mineflayer chat.
Acceptance: validates max length and cooldown.

### B22 Basic action: chat AI private
Implement `chat_ai_private` through backend chat bus, not Minecraft public chat.
Acceptance: message is persisted and streamed.

### B23 Basic action: move to
Implement `move_to` using pathfinder plugin.
Acceptance: returns failed on unreachable or timeout.

### B24 Basic action: follow player
Implement `follow_player` with stop conditions.
Acceptance: stops when target missing or action canceled.

### B25 Basic action: flee
Implement `flee` as path away from entity/player/position.
Acceptance: emits failure if no safe goal found.

### B26 Basic action: collect nearby item
Implement `collect_item` for visible dropped items.
Acceptance: validates distance and inventory space.

### B27 Basic action: mine visible block
Implement `mine_block` only for visible/reachable blocks and valid tools.
Acceptance: rejects unsafe/unreachable request.

### B28 Basic action: attack entity
Implement `attack_entity` with allowlist and friendly-fire guard.
Acceptance: cannot attack disallowed targets unless director override exists.

### B29 Routine interface
Create `Routine.run(agent, perception)` for deterministic role behavior.
Acceptance: routines do not import LLM providers.

### B30 Farmer routine
Implement minimal farming loop: find crop, harvest, replant, idle on missing tools.
Acceptance: routine emits task status events.

### B31 Miner routine
Implement minimal mining loop: mine safe visible common blocks, return failure on danger.
Acceptance: no branch mines downward blindly.

### B32 Guard routine
Implement guard area routine: patrol, warn, flee or attack allowed hostile mobs.
Acceptance: never attacks protected players by default.

### B33 Scheduler core
Create scheduler that ticks agents, enforces max concurrent actions and max LLM planning slots.
Acceptance: 20 agents tick with max N planning agents.

### B34 Wake-on-event routing
Wake affected agents on high-severity events, chat mentions, attacks, and leader commands.
Acceptance: only relevant agents move to planning queue.

### B35 Action cancellation
Add cancel token for long actions when attacked, paused, disconnected, or director interrupts.
Acceptance: long action can be canceled in tests.

### B36 Reflection job hook
Add backend hook that receives major events and calls reflection service interface.
Acceptance: event severity >= 4 creates reflection request.

### B37 Recorder permissions model
Add viewer roles: recorder, ai-team-human, human-team, unaffiliated.
Acceptance: chat API filters by role.

### B38 Paper plugin contract
Define plugin message contract for team assignment, private chat, recorder visibility, and server events.
Acceptance: contract docs and TS types exist.

### B39 Minimal Paper plugin scaffold
Create `packages/minecraft-plugin` with Gradle scaffold and no-op plugin.
Acceptance: plugin builds.

### B40 Paper private chat command
Add `/aichat <message>` and `/teamchat <message>` command stubs.
Acceptance: messages are hidden from public chat and logged.

### B41 Paper event forwarder
Forward player join, leave, death, damage, chat, and block break to backend endpoint.
Acceptance: failures are logged without crashing server.

### B42 Backend plugin endpoint
Add signed local endpoint for plugin events.
Acceptance: rejects missing shared secret.

### B43 Scenario loader
Load scenario JSON with teams, roles, starting goals, secret roles, and director triggers.
Acceptance: bad scenario reports exact field error.

### B44 Clip marker API
Persist manual and automatic clip markers.
Acceptance: list markers by session.

### B45 Session model
Add sessions table and current session state.
Acceptance: all events attach to session_id.

### B46 Runbook script
Add scripts for starting local server, backend, and dashboard separately.
Acceptance: README command section is under 30 lines.

### B47 3-agent smoke test
Mock Mineflayer and run leader, farmer, miner through chat, event, reflection hook.
Acceptance: smoke test passes without Minecraft.

### B48 20-agent scheduler test
Mock 20 agents and verify bounded planning concurrency.
Acceptance: test proves no more than configured LLM slots run.

### B49 Local integration checklist
Add checklist for offline server, 3 bots, 8 bots, 20 bots, private chat, director pause.
Acceptance: checklist is committed as `plans/v1-test-checklist.md`.

### B50 Backend V1 tag
Freeze backend V1 endpoints and contracts.
Acceptance: no TODOs remain in exported contract names.
