import test from "node:test";
import assert from "node:assert/strict";

import { StudioEventBus } from "../events/bus";
import type { DirectorCommand } from "../events/types";
import { createStudioPersistence } from "../db/runtime";
import { createApp } from "../server/app";

test("director pause agent emits a command", async () => {
  const eventBus = new StudioEventBus();
  const commands: DirectorCommand[] = [];
  eventBus.subscribe("director.command", (command) => commands.push(command));
  const app = createApp({ studioConfig: testConfig(), agents: [], eventBus });

  const response = await app.inject({
    method: "POST",
    url: "/director/agents/farmer-1/pause",
    payload: { requestedBy: "operator", reason: "scene reset" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "pause-agent");
  assert.equal(commands[0].targetAgentId, "farmer-1");
  await app.close();
});

test("director event injection validates body", async () => {
  const app = createApp({ studioConfig: testConfig(), agents: [] });

  const response = await app.inject({
    method: "POST",
    url: "/director/events",
    payload: { severity: 2 },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /type/);
  await app.close();
});

test("director event injection and clip markers persist", async () => {
  const persistence = createStudioPersistence(":memory:");
  const app = createApp({ studioConfig: testConfig(), agents: [], persistence });

  const eventResponse = await app.inject({
    method: "POST",
    url: "/director/events",
    payload: {
      id: "event-1",
      type: "leader.attack",
      actorId: "leader",
      targetId: "farmer-1",
      severity: 5,
      payload: { weapon: "wooden_sword" },
    },
  });
  const clipResponse = await app.inject({
    method: "POST",
    url: "/director/clips",
    payload: { label: "leader attack", eventId: "event-1", notes: "manual marker" },
  });

  assert.equal(eventResponse.statusCode, 201);
  assert.equal(clipResponse.statusCode, 201);
  assert.equal(persistence.events.list({ sessionId: persistence.session.id }).length, 1);
  assert.equal(persistence.clipMarkers.listBySession(persistence.session.id).length, 1);

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
