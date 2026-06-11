import test from "node:test";
import assert from "node:assert/strict";

import { AiChatMessagesRepository } from "./ai-chat-messages";
import { ClipMarkersRepository } from "./clip-markers";
import { EventsRepository } from "./events";
import { SessionsRepository } from "./sessions";
import { openMigratedTestDb } from "./test-support";

test("chat visibility filters recorder and unaffiliated access", () => {
  const db = openMigratedTestDb();
  const sessions = new SessionsRepository(db);
  const chat = new AiChatMessagesRepository(db);
  sessions.create({ id: "session-one" });

  chat.create({
    id: "public-message",
    sessionId: "session-one",
    senderId: "leader",
    visibility: "public",
    content: "Meet at spawn",
    timestamp: "2026-06-10T20:00:00.000Z",
  });
  chat.create({
    id: "ai-message",
    sessionId: "session-one",
    senderId: "miner",
    recipients: ["leader"],
    topic: "diamonds",
    urgency: 4,
    visibility: "ai",
    content: "Found diamonds",
    location: { x: 10, y: 12, z: -4 },
    timestamp: "2026-06-10T20:01:00.000Z",
  });
  chat.create({
    id: "recorder-message",
    sessionId: "session-one",
    senderId: "director",
    visibility: "recorder",
    content: "Mark this beat",
    timestamp: "2026-06-10T20:02:00.000Z",
  });

  assert.deepEqual(
    chat.listForViewer({ sessionId: "session-one", viewerRole: "recorder" }).map((item) => item.id),
    ["public-message", "ai-message", "recorder-message"],
  );
  assert.deepEqual(
    chat
      .listForViewer({ sessionId: "session-one", viewerRole: "unaffiliated" })
      .map((item) => item.id),
    ["public-message"],
  );
  assert.deepEqual(chat.listBySession({ sessionId: "session-one" })[1]?.recipients, [
    "leader",
  ]);
  db.close();
});

test("clip markers create and list by session", () => {
  const db = openMigratedTestDb();
  const sessions = new SessionsRepository(db);
  const events = new EventsRepository(db);
  const markers = new ClipMarkersRepository(db);
  sessions.create({ id: "session-one" });
  sessions.create({ id: "session-two" });
  events.insert({
    id: "event-diamond",
    sessionId: "session-one",
    type: "block.found",
    severity: 4,
    timestamp: "2026-06-10T20:00:00.000Z",
  });

  markers.create({
    id: "clip-one",
    sessionId: "session-one",
    title: "Diamond reveal",
    notes: "Miner finds the vein",
    sourceEventId: "event-diamond",
    timestamp: "2026-06-10T20:01:00.000Z",
  });
  markers.create({
    id: "clip-two",
    sessionId: "session-two",
    title: "Other session",
    timestamp: "2026-06-10T20:02:00.000Z",
  });

  assert.deepEqual(markers.listBySession("session-one"), [
    {
      id: "clip-one",
      sessionId: "session-one",
      title: "Diamond reveal",
      notes: "Miner finds the vein",
      sourceEventId: "event-diamond",
      timestamp: "2026-06-10T20:01:00.000Z",
    },
  ]);
  db.close();
});
