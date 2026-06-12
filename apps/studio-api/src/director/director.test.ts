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

test("director injection emits role and god dialogue commands", async () => {
  const eventBus = new StudioEventBus();
  const commands: DirectorCommand[] = [];
  eventBus.subscribe("director.command", (command) => commands.push(command));
  const app = createApp({ studioConfig: testConfig(), agents: [agent("farmer-1")], eventBus });

  const roleResponse = await app.inject({
    method: "POST",
    url: "/director/injections",
    payload: {
      kind: "role",
      scope: "agent",
      agentId: "farmer-1",
      text: "Spy",
      requestedBy: "director",
    },
  });
  const godsResponse = await app.inject({
    method: "POST",
    url: "/director/injections",
    payload: {
      kind: "god-dialogue",
      scope: "subteam",
      subteamId: "oak",
      text: "The sky demands a base before sunset.",
      requestedBy: "director",
    },
  });

  assert.equal(roleResponse.statusCode, 201);
  assert.equal(godsResponse.statusCode, 201);
  assert.equal(commands[0]?.type, "set-agent-role");
  assert.equal(commands[0]?.targetAgentId, "farmer-1");
  assert.equal(commands[0]?.payload.role, "Spy");
  assert.equal(commands[1]?.type, "god-dialogue");
  assert.equal(commands[1]?.payload.subteamId, "oak");
  await app.close();
});

test("director can add an agent to the active session", async () => {
  const eventBus = new StudioEventBus();
  const commands: DirectorCommand[] = [];
  const agents = [agent("farmer-1")];
  eventBus.subscribe("director.command", (command) => commands.push(command));
  const app = createApp({ studioConfig: testConfig(), agents, eventBus });

  const response = await app.inject({
    method: "POST",
    url: "/director/agents",
    payload: {
      id: "spy-1",
      name: "Spy One",
      account: { username: "SpyOne", auth: "offline" },
      role: "Spy",
      team: "ai",
      subteam: "oak",
      providerRef: "deepseek",
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(agents.length, 2);
  assert.equal(commands[0]?.type, "add-agent");
  assert.equal(commands[0]?.targetAgentId, "spy-1");
  assert.equal(response.json().agent.role, "Spy");
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

function agent(id: string) {
  return {
    id,
    name: id,
    account: { username: id },
    role: "farmer",
    team: "ai",
    subteam: "oak",
    allowedActions: ["idle", "chat_ai_private"],
    providerRef: "deepseek",
  };
}
