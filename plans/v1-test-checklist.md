# V1 Test Checklist

Use this tonight to verify the smallest useful demo.

## Backend

- Backend starts and `/healthz` returns ok.
- SQLite migrations run on empty DB.
- 3 agents load from JSON config.
- 8 agents load from JSON config.
- 20 agents load from JSON config.
- Scheduler caps concurrent LLM planning.
- Scheduler cancels long actions on pause, disconnect, attacked, and director interrupt.
- Scenario JSON loads teams, roles, goals, secret roles, and director triggers.
- Pause all and resume all work.
- Pause one agent and resume one agent work.
- AI private chat persists and streams.
- Event injection creates event feed item.
- Clip marker persists.

## Minecraft

- Local offline Java server starts.
- One bot joins.
- Three bots join.
- Eight bots join.
- Twenty bots join or fail with clear errors.
- Bot can idle, move, follow, chat public, chat AI private.
- Failed path/action returns clear reason.

## LLM

- [x] Documented mock provider path returns structured decision without real provider keys (`apps/studio-api/src/llm/testing/mock-provider.ts`).
- [x] Invalid provider output or provider error falls back safely.
- [x] Major event triggers reflection through the mocked leader attack fixture.
- [x] Farmer attacked by leader reduces loyalty.
- [x] Group broadcast reaches relevant agents through grouped planning coverage.
- [x] Direct mentions, attacks, deaths, diamond finds, leader commands, and betrayal events wake relevant agents only.

## Frontend

- [x] Mock mode boots without backend via `VITE_STUDIO_MOCKS`.
- [x] Dashboard renders integrated agents, chat, events/director/clips, scenario, LLM queue, action log, roster, config, and server panels.
- [x] Agent list handles 20 mock agents.
- [x] Event feed handles 100 mock events.
- [x] AI chat composer can send private messages in mock mode.
- [x] Viewer role affects chat visibility.
- [x] Director can pause all in mock mode.
- [x] Director can inject an event in mock mode.
- [x] Director can mark clips in mock mode.
- [x] V1 frontend panels include empty, loading, disabled, and error states.
- [x] Visible frontend labels are frozen for V1 mock demo; no TODO labels should appear.
- [ ] Dashboard connects to backend with `VITE_STUDIO_MOCKS=false`.
- [ ] Live backend event feed updates in the integrated dashboard.

## Demo Scenario

- Start scenario with leader, farmers, miners, guards, prankster, traitor.
- Miner finds diamonds and posts AI private chat.
- Leader attacks farmer.
- Farmer reflection changes loyalty and emits warning.
- Nearby agents react through routine or planning.
- Director marks at least three clips.
