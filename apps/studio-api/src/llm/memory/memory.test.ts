import assert from "node:assert/strict";
import test from "node:test";

import type { MemoryRecord, RelationshipRecord } from "../../db";
import { evaluateMemoryWritePolicy, selectMemoriesForPrompt } from "./index";

test("memory selection is deterministic across sources and respects budget", () => {
  const memories: MemoryRecord[] = [
    memory("recent-a", "farmer", "Routine harvest path", 2, "2026-06-10T21:00:00.000Z"),
    memory("important-b", "farmer", "Leader attacked farmer", 5, "2026-06-10T21:01:00.000Z"),
    memory("important-a", "farmer", "Guard promised protection", 4, "2026-06-10T21:02:00.000Z"),
  ];
  const relationships: RelationshipRecord[] = [
    { agentId: "farmer", targetId: "leader", trust: 10, loyalty: 15, fear: 90, tags: ["attacked"] },
    { agentId: "farmer", targetId: "guard", trust: 80, loyalty: 75, fear: 20, tags: ["ally"] },
  ];
  const repositories = {
    memories: {
      listRecent: () => [...memories],
      listImportant: () => [...memories].filter((item) => item.importance >= 4),
    },
    relationships: {
      listForAgent: () => [...relationships],
    },
  };

  const first = selectMemoriesForPrompt({
    agentId: "farmer",
    repositories,
    scenarioMemories: [{ id: "scenario", summary: "Farmers should survive the night", priority: 5 }],
    budget: { maxChars: 200, maxItems: 5 },
  });
  const second = selectMemoriesForPrompt({
    agentId: "farmer",
    repositories,
    scenarioMemories: [{ id: "scenario", summary: "Farmers should survive the night", priority: 5 }],
    budget: { maxChars: 200, maxItems: 5 },
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => `${item.source}:${item.id}`), [
    "important:important-b",
    "important:important-a",
    "relationship:farmer->leader",
    "relationship:farmer->guard",
    "scenario:scenario",
  ]);
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
});

test("memory write policy records meaningful events but ignores routine actions", () => {
  assert.equal(evaluateMemoryWritePolicy({
    agentId: "farmer",
    event: {
      id: "routine",
      type: "routine.tick",
      severity: 1,
      payload: {},
    },
  }), undefined);

  const betrayal = evaluateMemoryWritePolicy({
    agentId: "farmer",
    event: {
      id: "betrayal",
      type: "agent.betrayal",
      severity: 2,
      actorId: "leader",
      targetId: "farmer",
      payload: {},
    },
  });

  assert.equal(betrayal?.kind, "betrayal");
  assert.equal(betrayal?.importance, 5);

  const discovery = evaluateMemoryWritePolicy({
    agentId: "miner",
    event: {
      id: "diamonds",
      type: "block.found",
      severity: 2,
      payload: { item: "diamond_ore" },
    },
  });
  assert.equal(discovery?.kind, "discovery");
});

function memory(
  id: string,
  agentId: string,
  summary: string,
  importance: MemoryRecord["importance"],
  createdAt: string,
): MemoryRecord {
  return {
    id,
    agentId,
    kind: "test",
    summary,
    importance,
    createdAt,
  };
}
