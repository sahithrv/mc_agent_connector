import test from "node:test";
import assert from "node:assert/strict";

import { createPerceptionSnapshot } from "./perception";
import type { BotHandle } from "./types";

test("createPerceptionSnapshot excludes raw Mineflayer objects", () => {
  const bot: BotHandle = {
    username: "AdaBot",
    health: 18,
    food: 17,
    entity: {
      id: "self",
      type: "player",
      username: "AdaBot",
      position: { x: 10, y: 64, z: 10, distanceTo: () => 0 },
    },
    entities: {
      player: {
        id: 1,
        type: "player",
        username: "Steve",
        position: { x: 12, y: 64, z: 10, distanceTo: () => 2 },
      },
      zombie: {
        id: 2,
        type: "mob",
        name: "zombie",
        position: { x: 8, y: 64, z: 10 },
      },
      item: {
        id: 3,
        type: "object",
        name: "diamond",
        position: { x: 11, y: 64, z: 10 },
      },
    },
    inventory: {
      items: () => [{ name: "stone_pickaxe", count: 1, slot: 36 }],
    },
    on() {
      return this;
    },
    chat() {},
    quit() {},
  };

  const snapshot = createPerceptionSnapshot({
    agentId: "agent-a",
    bot,
    now: new Date("2026-06-10T00:00:00.000Z"),
  });

  assert.equal(snapshot.health, 18);
  assert.equal(snapshot.inventory[0]?.name, "stone_pickaxe");
  assert.equal(snapshot.nearbyPlayers[0]?.username, "Steve");
  assert.equal(snapshot.nearbyMobs[0]?.name, "zombie");
  assert.equal(snapshot.nearbyItems[0]?.name, "diamond");
  assert.equal("entities" in snapshot, false);
  assert.equal("distanceTo" in (snapshot.position ?? {}), false);
  assert.equal("distanceTo" in (snapshot.nearbyPlayers[0]?.position ?? {}), false);
});
