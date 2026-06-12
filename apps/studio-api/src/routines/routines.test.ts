import test from "node:test";
import assert from "node:assert/strict";

import { GuardRoutine } from "./guard";

test("guard routine warns instead of attacking protected players", () => {
  const routine = new GuardRoutine();
  const result = routine.run(
    {
      id: "guard",
      name: "Guard",
      role: "guard",
      team: "red",
      routine: "guard",
      allowedActions: ["attack_entity", "chat_public"],
    },
    {
      agentId: "guard",
      health: 20,
      inventory: { tools: [], seeds: 0 },
      visibleBlocks: [],
      nearbyEntities: [
        {
          id: "zombie-1",
          type: "zombie",
          hostile: true,
        },
      ],
      nearbyPlayers: [
        {
          id: "player-1",
          name: "ProtectedPlayer",
          protected: true,
          threatening: true,
        },
      ],
    },
  );

  assert.equal(result.action?.action, "chat_public");
});

test("guard routine does not warn just because an ally is protected", () => {
  const routine = new GuardRoutine();
  const result = routine.run(
    {
      id: "guard",
      name: "Guard",
      role: "guard",
      team: "red",
      routine: "guard",
      allowedActions: ["move_to", "chat_public"],
    },
    {
      agentId: "guard",
      health: 20,
      inventory: { tools: [], seeds: 0 },
      visibleBlocks: [],
      nearbyEntities: [],
      nearbyPlayers: [
        {
          id: "ally-1",
          name: "AllyBot",
          protected: true,
        },
      ],
      patrolPoints: [{ x: 8, y: 64, z: 0 }],
    },
  );

  assert.equal(result.action?.action, "move_to");
});
