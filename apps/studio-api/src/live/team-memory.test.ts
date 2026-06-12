import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { SubteamDirectory } from "./subteams";
import { TeamMemoryStore, teamMemoryPromptMemories } from "./team-memory";

test("TeamMemoryStore creates one channel per subteam and shares memory inside a subteam", () => {
  const agents = [
    agent("oak-miner", "OakMiner", "miner", "oak"),
    agent("oak-farmer", "OakFarmer", "farmer", "oak"),
    agent("iron-guard", "IronGuard", "guard", "iron"),
  ];
  const memory = memoryFor(agents);

  assert.deepEqual(memory.channelIds(), ["iron", "oak"]);

  memory.recordNeed("oak", "planks");

  assert.match(memory.recentForAgent("oak-farmer", { log: false })?.summary ?? "", /need=planks/);
  assert.equal(memory.recentForAgent("iron-guard", { log: false })?.summary, "");
});

test("TeamMemoryStore uses one centralized channel when agents have one team", () => {
  const agents = [
    agent("miner-1", "MinerBot", "miner", undefined, "ai"),
    agent("farmer-1", "FarmerBot", "farmer", undefined, "ai"),
  ];
  const memory = memoryFor(agents);

  assert.deepEqual(memory.channelIds(), ["ai"]);

  memory.recordActivity("miner-1", { action: "mine_block", params: { block: "stone" } });

  assert.match(memory.recentForAgent("farmer-1", { log: false })?.summary ?? "", /miner-1 doing mine_block stone/);
});

test("TeamMemoryStore recent memory excludes expired entries and respects max count", () => {
  let now = 1_000;
  const memory = memoryFor([agent("farmer-1", "FarmerBot", "farmer", "oak")], {
    now: () => now,
    maxEntriesPerTeam: 2,
    ttlMs: 100,
  });

  memory.recordNeed("oak", "planks");
  now += 10;
  memory.recordNeed("oak", "stone");
  now += 10;
  memory.recordNeed("oak", "food");

  const bounded = memory.recentForAgent("farmer-1", { log: false })?.summary ?? "";
  assert.doesNotMatch(bounded, /planks/);
  assert.match(bounded, /stone/);
  assert.match(bounded, /food/);

  now += 120;
  assert.equal(memory.recentForAgent("farmer-1", { log: false })?.summary, "");
});

test("TeamMemoryStore inventory summaries keep useful items and avoid noisy full dumps", () => {
  const memory = memoryFor([agent("farmer-1", "FarmerBot", "farmer", "oak")]);

  memory.recordInventory("farmer-1", [
    { name: "cobblestone", count: 12 },
    { name: "seeds", count: 3 },
    { name: "feather", count: 64 },
    { name: "diorite", count: 4 },
  ]);

  const summary = memory.recentForAgent("farmer-1", { log: false })?.summary ?? "";
  assert.match(summary, /cobblestone=12/);
  assert.match(summary, /seeds=3/);
  assert.doesNotMatch(summary, /feather/);
  assert.doesNotMatch(summary, /diorite/);
});

test("teamMemoryPromptMemories returns a compact recent team memory summary", () => {
  const memory = memoryFor([
    agent("miner-1", "MinerBot", "miner", "oak"),
    agent("builder-1", "BuilderBot", "builder", "oak"),
  ]);

  memory.recordActivity("miner-1", { action: "mine_block", params: { block: "stone" } });
  memory.recordNeed("oak", "planks");

  const memories = teamMemoryPromptMemories(memory, "builder-1");

  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.id, "recent-team-memory");
  assert.match(memories[0]?.summary ?? "", /Recent team memory \(oak\):/);
  assert.match(memories[0]?.summary ?? "", /miner-1 doing mine_block stone/);
  assert.match(memories[0]?.summary ?? "", /need=planks/);
});

function memoryFor(
  agents: AgentConfig[],
  overrides: Partial<ConstructorParameters<typeof TeamMemoryStore>[0]> = {},
): TeamMemoryStore {
  const subteams = new SubteamDirectory(agents);
  return new TeamMemoryStore({
    subteams,
    log: () => {},
    ...overrides,
  });
}

function agent(
  id: string,
  username: string,
  role: string,
  subteam?: string,
  team = "ai",
): AgentConfig {
  return {
    id,
    name: id,
    account: { username, auth: "offline" },
    role,
    team,
    subteam,
    leader: role === "leader",
    mode: "routine",
    routine: role,
    allowedActions: [
      "idle",
      "move_to",
      "follow_player",
      "flee",
      "collect_item",
      "mine_block",
      "craft_item",
      "place_block",
      "attack_entity",
    ],
    providerRef: "mock",
    visibility: "ai",
  };
}
