import test from "node:test";
import assert from "node:assert/strict";

import { PLUGIN_SHARED_SECRET_HEADER } from "@mc-ai-video/contracts";

import { createStudioPersistence } from "../db/runtime";
import { StudioEventBus } from "../events/bus";
import { createApp } from "../server/app";

test("plugin event endpoint rejects missing shared secret", async () => {
  const app = createApp({
    studioConfig: testConfig(),
    agents: [],
    pluginSharedSecret: "local-secret",
  });

  const response = await app.inject({
    method: "POST",
    url: "/plugin/events",
    payload: { type: "player_join", severity: 1, payload: { player: "Ada" } },
  });

  assert.equal(response.statusCode, 401);
  await app.close();
});

test("plugin event endpoint accepts signed events", async () => {
  const eventBus = new StudioEventBus();
  let receivedType: string | undefined;
  const persistence = createStudioPersistence(":memory:");
  eventBus.subscribe("game.event", (event) => {
    receivedType = event.type;
  });
  const app = createApp({
    studioConfig: testConfig(),
    agents: [],
    eventBus,
    persistence,
    pluginSharedSecret: "local-secret",
  });

  const response = await app.inject({
    method: "POST",
    url: "/plugin/events",
    headers: { [PLUGIN_SHARED_SECRET_HEADER]: "local-secret" },
    payload: {
      eventId: "plugin-event-1",
      type: "player_join",
      actor: { uuid: "player-uuid-1", username: "Ada" },
      severity: 1,
      payload: { player: "Ada" },
    },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(receivedType, "player_join");
  assert.deepEqual(
    persistence.events.list({ sessionId: persistence.session.id }).map((event) => ({
      id: event.id,
      actorId: event.actorId,
    })),
    [{ id: "plugin-event-1", actorId: "player-uuid-1" }],
  );
  await app.close();
  persistence.db.close();
});

function testConfig() {
  return {
    server: { host: "127.0.0.1", port: 0, logger: false },
    tickRates: { schedulerMs: 1000, routineMs: 2000, perceptionMs: 500 },
    database: { path: ":memory:" },
    llm: { maxConcurrency: 1 },
  };
}
