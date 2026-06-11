import test from "node:test";
import assert from "node:assert/strict";

import { EventsRepository } from "./events";
import { SessionsRepository } from "./sessions";
import { openMigratedTestDb } from "./test-support";

test("sessions track the current session", () => {
  const db = openMigratedTestDb();
  const sessions = new SessionsRepository(db);

  sessions.create({
    id: "session-one",
    title: "First session",
    createdAt: "2026-06-10T20:00:00.000Z",
  });
  sessions.create({
    id: "session-two",
    title: "Second session",
    createdAt: "2026-06-10T21:00:00.000Z",
  });

  assert.equal(sessions.getCurrent()?.id, "session-two");
  assert.equal(sessions.get("session-one")?.isCurrent, false);
  assert.deepEqual(sessions.list().map((session) => session.id), [
    "session-one",
    "session-two",
  ]);
  db.close();
});

test("events insert and list by session with filters", () => {
  const db = openMigratedTestDb();
  const sessions = new SessionsRepository(db);
  const events = new EventsRepository(db);
  sessions.create({ id: "session-one" });
  sessions.create({ id: "session-two" });

  events.insert({
    id: "event-one",
    sessionId: "session-one",
    type: "block.found",
    actorId: "miner",
    targetId: "diamond",
    location: { x: 4, y: 11, z: -2, world: "overworld" },
    severity: 4,
    payload: { block: "diamond_ore" },
    timestamp: "2026-06-10T20:00:00.000Z",
  });
  events.insert({
    id: "event-two",
    sessionId: "session-one",
    type: "agent.chat",
    actorId: "farmer",
    severity: 2,
    payload: { line: "Need seeds" },
    timestamp: "2026-06-10T20:01:00.000Z",
  });
  events.insert({
    id: "event-other-session",
    sessionId: "session-two",
    type: "block.found",
    actorId: "miner",
    severity: 3,
    timestamp: "2026-06-10T20:02:00.000Z",
  });

  assert.deepEqual(events.list({ sessionId: "session-one" }).map((event) => event.id), [
    "event-one",
    "event-two",
  ]);
  assert.deepEqual(
    events.list({ sessionId: "session-one", type: "block.found" }).map((event) => event.id),
    ["event-one"],
  );
  assert.deepEqual(
    events.list({ sessionId: "session-one", actorId: "farmer" }).map((event) => event.id),
    ["event-two"],
  );
  assert.deepEqual(events.list({ sessionId: "session-one" })[0]?.payload, {
    block: "diamond_ore",
  });
  db.close();
});
