# Paper Plugin Bridge Contract

The Paper bridge is optional. Backend startup must not require the plugin, and plugin failures must not stop the Minecraft server.

## Transport

- Endpoint: `POST /plugin/events`
- Header: `X-MCAS-Plugin-Secret: <local shared secret>`
- Body: `PluginServerEvent` from `src/types.ts`
- Schema version: `v1`

The shared secret is local-only protection for the developer server. Backend code should validate it with `hasPluginSharedSecret`.

## Visibility

- `/aichat <message>` creates an `ai_private_chat` event with `visibility: "ai"`.
- `/teamchat <message>` creates a `human_team_chat` event with `visibility: "human-team"`.
- Public Minecraft chat creates `player_chat` with `visibility: "public"`.
- Non-chat server telemetry uses `visibility: "recorder"` unless promoted by backend policy.

Private command content is never sent back through public Minecraft chat. Recorder access is metadata only; backend/dashboard filtering decides who can read private channels.

## Team And Recorder Data

`PluginPlayerRef.teamId` is the player's current scoreboard team name when available. `PluginTeamAssignment` documents future backend-to-plugin team updates without making them required for V1.

`PluginRecorderVisibility` documents which channels a recorder may inspect. The plugin only reports `isRecorder` from permission metadata; it does not grant dashboard access.
