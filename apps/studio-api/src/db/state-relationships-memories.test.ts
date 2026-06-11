import test from "node:test";
import assert from "node:assert/strict";

import { AgentStateRepository } from "./agent-state";
import { EventsRepository } from "./events";
import { MemoriesRepository } from "./memories";
import { RelationshipsRepository } from "./relationships";
import { SessionsRepository } from "./sessions";
import { openMigratedTestDb } from "./test-support";

test("agent_state upserts and fetches latest state", () => {
  const db = openMigratedTestDb();
  const states = new AgentStateRepository(db);

  states.upsert({
    agentId: "miner",
    mode: "routine",
    role: "miner",
    currentTask: "dig safe tunnel",
    health: 20,
    food: 18,
    position: { x: 1, y: 64, z: 2 },
    updatedAt: "2026-06-10T20:00:00.000Z",
  });
  states.upsert({
    agentId: "miner",
    mode: "acting",
    role: "miner",
    health: 16,
    food: 17,
    position: { x: 2, y: 63, z: 3 },
    updatedAt: "2026-06-10T20:01:00.000Z",
  });

  assert.deepEqual(states.get("miner"), {
    agentId: "miner",
    mode: "acting",
    role: "miner",
    health: 16,
    food: 17,
    position: { x: 2, y: 63, z: 3 },
    updatedAt: "2026-06-10T20:01:00.000Z",
  });
  db.close();
});

test("relationships update by agent and target", () => {
  const db = openMigratedTestDb();
  const relationships = new RelationshipsRepository(db);

  relationships.upsert({
    agentId: "farmer",
    targetId: "leader",
    trust: 0.4,
    loyalty: 0.7,
    fear: 0.1,
    tags: ["leader"],
  });
  relationships.upsert({
    agentId: "farmer",
    targetId: "leader",
    trust: 0.2,
    loyalty: 0.5,
    fear: 0.6,
    tags: ["leader", "hit-me"],
  });

  assert.deepEqual(relationships.get("farmer", "leader"), {
    agentId: "farmer",
    targetId: "leader",
    trust: 0.2,
    loyalty: 0.5,
    fear: 0.6,
    tags: ["leader", "hit-me"],
  });
  assert.deepEqual(relationships.listForAgent("farmer").map((item) => item.targetId), [
    "leader",
  ]);
  db.close();
});

test("memories list recent and important items", () => {
  const db = openMigratedTestDb();
  const sessions = new SessionsRepository(db);
  const events = new EventsRepository(db);
  const memories = new MemoriesRepository(db);
  sessions.create({ id: "session-one" });
  events.insert({
    id: "event-attack",
    sessionId: "session-one",
    type: "agent.attacked",
    severity: 5,
  });

  memories.create({
    id: "memory-low",
    agentId: "farmer",
    kind: "observation",
    summary: "Leader walked by",
    importance: 2,
    createdAt: "2026-06-10T20:00:00.000Z",
  });
  memories.create({
    id: "memory-high",
    agentId: "farmer",
    kind: "threat",
    summary: "Leader attacked me",
    eventId: "event-attack",
    importance: 5,
    createdAt: "2026-06-10T20:02:00.000Z",
  });
  memories.create({
    id: "memory-mid",
    agentId: "farmer",
    kind: "goal",
    summary: "Need safer farm route",
    importance: 4,
    createdAt: "2026-06-10T20:01:00.000Z",
  });

  assert.deepEqual(memories.listRecent({ agentId: "farmer", limit: 2 }).map((item) => item.id), [
    "memory-high",
    "memory-mid",
  ]);
  assert.deepEqual(
    memories.listImportant({ agentId: "farmer" }).map((item) => item.id),
    ["memory-high", "memory-mid"],
  );
  db.close();
});
