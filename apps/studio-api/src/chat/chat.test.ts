import test from "node:test";
import assert from "node:assert/strict";

import { createStudioPersistence } from "../db/runtime";
import { createApp } from "../server/app";

test("chat API filters AI-private messages by viewer role", async () => {
  const persistence = createStudioPersistence(":memory:");
  const app = createApp({ studioConfig: testConfig(), agents: [], persistence });

  const sendResponse = await app.inject({
    method: "POST",
    url: "/director/chat",
    payload: {
      senderId: "director",
      recipientIds: ["farmer-1"],
      content: "Keep this inside the AI team.",
      visibility: "ai",
    },
  });

  assert.equal(sendResponse.statusCode, 201);

  const unaffiliated = await app.inject({
    method: "GET",
    url: "/chat/messages?viewerRole=unaffiliated",
  });
  const recorder = await app.inject({
    method: "GET",
    url: "/chat/messages?viewerRole=recorder",
  });

  assert.equal(unaffiliated.statusCode, 200);
  assert.deepEqual(unaffiliated.json(), { messages: [] });
  assert.equal(recorder.statusCode, 200);
  assert.equal(recorder.json().messages.length, 1);
  assert.equal(
    persistence.chatMessages.listBySession({ sessionId: persistence.session.id }).length,
    1,
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
