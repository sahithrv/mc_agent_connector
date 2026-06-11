import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import type { AiChatMessage, GameEvent } from "@mc-ai-video/contracts";

import { StudioEventBus } from "../events/bus";
import { createApp } from "../server/app";

test("dashboard WebSocket receives event and chat envelopes", async () => {
  const eventBus = new StudioEventBus();
  const app = createApp({ studioConfig: testConfig(), agents: [], eventBus });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws/dashboard`);
  const messages: unknown[] = [];

  client.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)));
  });
  await once(client, "open");

  eventBus.emit("game.event", gameEvent());
  eventBus.emit("chat.message", chatMessage());
  await waitFor(() => messages.length === 2);

  assert.deepEqual(
    messages.map((message) => (message as { type: string }).type),
    ["game.event", "chat.message"],
  );

  client.close();
  await app.close();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("timed out waiting for WebSocket messages");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function gameEvent(): GameEvent {
  return {
    id: "event-1",
    type: "player_join",
    severity: 1,
    visibility: "public",
    payload: { player: "Ada" },
    timestamp: new Date(0).toISOString(),
  };
}

function chatMessage(): AiChatMessage {
  return {
    id: "chat-1",
    senderId: "director",
    recipientIds: ["farmer-1"],
    visibility: "ai",
    content: "Check the farm.",
    timestamp: new Date(0).toISOString(),
  };
}

function testConfig() {
  return {
    server: { host: "127.0.0.1", port: 0, logger: false },
    tickRates: { schedulerMs: 1000, routineMs: 2000, perceptionMs: 500 },
    database: { path: ":memory:" },
    llm: { maxConcurrency: 1 },
  };
}
