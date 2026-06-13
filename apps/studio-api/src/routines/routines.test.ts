import test from "node:test";
import assert from "node:assert/strict";

import { GuardRoutine } from "./guard";
import { SurvivalRoutine } from "./survival";

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

test("survival routine ignores generic item entities without a useful drop name", () => {
  const routine = new SurvivalRoutine();
  const result = routine.run(
    {
      id: "farmer",
      name: "Farmer",
      role: "farmer",
      team: "red",
      routine: "survival",
      allowedActions: ["collect_item"],
    },
    {
      agentId: "farmer",
      health: 20,
      inventory: { tools: [], seeds: 0 },
      visibleBlocks: [],
      nearbyEntities: [
        {
          id: "generic-drop",
          type: "item",
          position: { x: 1, y: 64, z: 0 },
          distance: 1,
          hostile: false,
        },
      ],
      nearbyPlayers: [],
    },
  );

  assert.equal(result.action, undefined);
  assert.equal(result.status, "idle");
});
