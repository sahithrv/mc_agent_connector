# Backend V1 Local Runbook

Goal: run the backend without requiring the Paper plugin, then optionally add a local offline Paper server and bridge events into the backend.

Download a Paper server jar separately and save it as `.local/paper-server/paper.jar`.

## Commands

```powershell
npm install
npm run build
npm test
npm run start:api
cd packages/minecraft-plugin
gradle build
mkdir ..\..\.local\paper-server\plugins
copy build\libs\mc-ai-studio-paper-bridge-0.1.0.jar ..\..\.local\paper-server\plugins\
cd ..\..\.local\paper-server
java -Xmx2G -jar paper.jar --nogui
Set-Content eula.txt "eula=true"
(Get-Content server.properties) -replace "online-mode=true","online-mode=false" | Set-Content server.properties
java -Xmx2G -jar paper.jar --nogui
```

Keep `plugins/McAiStudioBridge/config.yml` `backend.shared-secret` aligned with the backend's `MCAS_PLUGIN_SHARED_SECRET`. Backend startup and health checks pass even with no plugin installed.

## Checks

1. Backend only: start `npm run start:api` and confirm `/healthz` returns ok.
2. One bot: start Paper in offline mode, connect one bot/player, and check join/leave logs.
3. Three bots: verify `/aichat hello` and `/teamchat hello` do not appear in public chat.
4. Twenty bots: connect in batches, watch backend and Paper logs for rejected or timed-out forwards.
5. Dashboard later: start the dashboard separately, then verify public chat, private chat, recorder events, and director controls in separate panels.
