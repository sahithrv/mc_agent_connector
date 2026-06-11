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
