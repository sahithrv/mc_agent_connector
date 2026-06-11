# Frontend Design Plan

## V1 Target

Build a local dashboard for directing, observing, and debugging Minecraft AI sessions tonight. The UI must prioritize control and visibility over polish.

## Pushback

Do not build a landing page. Do not build complex visualizations first. The V1 UI is an operations console: agents, chat, events, director controls, clip markers, and health.

## Frontend Rules

- Keep component files under 200 lines when practical.
- Use typed API clients from `packages/contracts`.
- Add short comments for non-obvious state sync and permission filtering.
- Prefer dense panels over decorative cards.
- Every control must show loading, error, and disabled states.

## Proposed Structure

```text
apps/studio-web/
  src/app/
  src/components/agents/
  src/components/chat/
  src/components/director/
  src/components/events/
  src/components/layout/
  src/components/session/
  src/lib/api/
  src/lib/ws/
  src/lib/state/
  src/styles/
```

## PR Slices

### F01 Web app scaffold
Create Vite React TypeScript app with build, lint, test scripts.
Acceptance: `npm run build` succeeds.

### F02 Shared contracts import
Import types from `packages/contracts`.
Acceptance: no duplicate frontend-only API types.

### F03 App shell
Create single dashboard route with header, left nav, main panel, right inspector.
Acceptance: no marketing content.

### F04 API client shell
Create typed fetch wrapper with base URL, JSON parsing, and error shape.
Acceptance: failed request displays useful message.

### F05 WebSocket client
Create reconnecting WebSocket client for backend event streams.
Acceptance: reconnect attempts are visible in UI state.

### F06 Session store
Create lightweight state store for current session, agents, events, chat, and connection status.
Acceptance: store unit tests cover updates.

### F07 Health banner
Show backend connection, Minecraft server status, bot count, and LLM queue status.
Acceptance: disconnected state is obvious.

### F08 Agent list panel
Show agents with name, role, mode, health, task, provider, and last update.
Acceptance: 20 agents fit without horizontal scrolling.

### F09 Agent status chips
Create compact mode chips: paused, routine, planning, acting, failed.
Acceptance: each state has distinct color and label.

### F10 Agent detail drawer
Show selected agent config, current task, relationships, memories, and last decision.
Acceptance: drawer handles missing data.

### F11 Agent pause control
Add pause/resume selected agent.
Acceptance: button disables while request is pending.

### F12 Pause all controls
Add pause all and resume all controls with confirmation.
Acceptance: accidental click cannot pause all immediately.

### F13 AI chat panel
Show AI private chat with sender, recipients, urgency, topic, location, timestamp.
Acceptance: urgent messages are visually distinct.

### F14 AI chat composer
Allow director/authorized human to send AI chat.
Acceptance: validates empty message and recipient.

### F15 Chat visibility selector
Add viewer role selector: recorder, AI-team human, human-team, unaffiliated.
Acceptance: unaffiliated cannot see private AI messages in UI.

### F16 Public chat mirror
Show public Minecraft chat separately from AI private chat.
Acceptance: private and public messages cannot be confused.

### F17 Event feed
Show events sorted newest first with type, actor, target, severity, location.
Acceptance: high-severity events stand out.

### F18 Event filters
Filter by severity, actor, event type, and text.
Acceptance: filters work for 100+ events.

### F19 Director command panel
Add buttons for inject event, group announcement, assign secret role, and start scenario.
Acceptance: each opens a small focused form.

### F20 Inject event form
Create form for event type, actor, target, severity, payload JSON.
Acceptance: invalid JSON is rejected client-side.

### F21 Group announcement form
Create form for sender, recipients, topic, urgency, content.
Acceptance: sends through AI chat endpoint.

### F22 Assign role form
Create form to assign role or secret role to one agent.
Acceptance: UI updates after success.

### F23 Scenario panel
Show loaded scenario, goals, teams, and triggers.
Acceptance: empty scenario state is readable.

### F24 Clip marker button
Add global button to mark clip with title and notes.
Acceptance: marker appears in clip list.

### F25 Clip list
Show clip markers with timestamp, source event, title, notes.
Acceptance: manual and automatic markers display differently.

### F26 LLM queue panel
Show active planning agents, queued agents, recent provider errors, rate-limit state.
Acceptance: helps debug slow sessions.

### F27 Action log panel
Show recent action requests/results with duration and failure reason.
Acceptance: failed actions are easy to inspect.

### F28 Relationship matrix
Create compact table for selected agent trust, loyalty, fear toward others.
Acceptance: handles 20 rows without layout break.

### F29 Memory list
Show selected agent memories by importance and recency.
Acceptance: long summaries clamp with expand.

### F30 Team roster panel
Show AI team, human teams, recorders, and unaffiliated users.
Acceptance: role assignment state is visible.

### F31 Server controls panel
Add placeholders for server start/stop/restart if backend exposes them later.
Acceptance: hidden or disabled if unsupported.

### F32 Config viewer
Show readonly agent and scenario JSON.
Acceptance: useful for debugging bad config.

### F33 Toast system
Add concise success/error toasts for director actions.
Acceptance: no blocking alerts.

### F34 Keyboard shortcuts
Add shortcuts for pause all, mark clip, focus chat.
Acceptance: visible in tooltips only.

### F35 Responsive layout pass
Support 1440p desktop and 1080p recording monitor.
Acceptance: no overlapping text.

### F36 Empty and loading states
Add empty/loading states for each panel.
Acceptance: no raw undefined/null visible.

### F37 Mock data mode
Add mock WebSocket/event feed for frontend work without backend.
Acceptance: frontend can demo 20 agents offline.

### F38 Frontend smoke test
Render dashboard with 20 mock agents and 100 events.
Acceptance: test passes.

### F39 Frontend V1 checklist
Create checklist for tonight: connect backend, observe 20 agents, send AI chat, pause all, mark clip.
Acceptance: checklist is in `plans/v1-test-checklist.md`.

### F40 Frontend V1 freeze
Freeze visible controls and labels.
Acceptance: no TODO labels in UI.
