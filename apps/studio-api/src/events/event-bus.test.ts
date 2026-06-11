import test from "node:test";
import assert from "node:assert/strict";

import type { GameEvent } from "@mc-ai-video/contracts";

import { StudioEventBus } from "./bus";

test("StudioEventBus delivers typed payloads to subscribers", () => {
  const bus = new StudioEventBus();
  const event: GameEvent = {
    id: "event-1",
    type: "player_join",
    severity: 1,
    visibility: "public",
    payload: { player: "Ada" },
    timestamp: new Date(0).toISOString(),
  };

  let received: GameEvent | undefined;
  const unsubscribe = bus.subscribe("game.event", (payload) => {
    received = payload;
  });

  bus.emit("game.event", event);
  unsubscribe();

  assert.deepEqual(received, event);
});
