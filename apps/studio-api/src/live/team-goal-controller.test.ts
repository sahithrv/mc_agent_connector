import test from "node:test";
import assert from "node:assert/strict";

import type { ActionResult, AgentConfig, Position } from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";
import type { PerceptionSnapshot } from "../routines";
import { fakeBot } from "../actions/test-helpers";
import { SubteamDirectory } from "./subteams";
import { TeamMemoryStore } from "./team-memory";
import { TeamGoalController } from "./team-goal-controller";

const ALL_ACTIONS = [
  "idle",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "craft_item",
  "place_block",
  "attack_entity",
];

test("TeamGoalController scouts a site and gives followers site work instead of endless follow", () => {
  const agents = [
    agent("leader-1", "LeaderBot", "leader", true),
    agent("farmer-1", "FarmerBot", "farmer"),
  ];
  const bots = new Map<string, BotHandle>([
    ["leader-1", fakeBot({ username: "LeaderBot", entity: entity("LeaderBot", { x: 0, y: 64, z: 0 }) })],
    ["farmer-1", placeBot("FarmerBot", { x: 29, y: 64, z: 0 }, ["cobblestone"])],
  ]);
  const controller = controllerFor(agents, bots);

  const leaderPlan = controller.plan({
    agent: agents[0] as AgentConfig,
    perception: perception("leader-1"),
    goal: "build a village and claim a site",
  });

  assert.equal(leaderPlan.action?.action, "move_to");
  const leaderTarget = leaderPlan.action?.params.position as Position;
  assert.equal(leaderTarget.x, 28);
  assert.equal(leaderTarget.y, 64);
  assert.equal(leaderTarget.z, 0);
  assert.equal(leaderPlan.action?.requestedBy, "live-autonomy");

  const farmerPlan = controller.plan({
    agent: agents[1] as AgentConfig,
    perception: perception("farmer-1"),
    goal: "follow leader to build a village",
  });

  assert.equal(farmerPlan.action?.action, "place_block");
  assert.notEqual(farmerPlan.action?.action, "follow_player");
});

test("TeamGoalController assigns claimed-site work by role", () => {
  const agents = [
    agent("leader-1", "LeaderBot", "leader", true),
    agent("farmer-1", "FarmerBot", "farmer"),
    agent("miner-1", "MinerBot", "miner"),
  ];
  const bots = new Map<string, BotHandle>([
    ["leader-1", fakeBot({ username: "LeaderBot", entity: entity("LeaderBot", { x: 0, y: 64, z: 0 }) })],
    ["farmer-1", placeBot("FarmerBot", { x: 29, y: 64, z: 0 }, ["oak_planks"])],
    ["miner-1", fakeBot({ username: "MinerBot", entity: entity("MinerBot", { x: 31, y: 64, z: 0 }) })],
  ]);
  const controller = controllerFor(agents, bots);

  controller.plan({
    agent: agents[0] as AgentConfig,
    perception: perception("leader-1"),
    goal: "build a village and gather materials",
  });

  const minerPlan = controller.plan({
    agent: agents[2] as AgentConfig,
    perception: perception("miner-1", {
      visibleBlocks: [
        {
          id: "stone-1",
          type: "stone",
          position: { x: 31, y: 64, z: 1 },
          safe: true,
        },
      ],
    }),
    goal: "build a village and gather materials",
  });
  const farmerPlan = controller.plan({
    agent: agents[1] as AgentConfig,
    perception: perception("farmer-1"),
    goal: "build a village and gather materials",
  });

  assert.equal(minerPlan.action?.action, "mine_block");
  assert.deepEqual(minerPlan.action?.params.position, { x: 31, y: 64, z: 1 });
  assert.equal(farmerPlan.action?.action, "place_block");
  assert.equal(farmerPlan.action?.params.block, "oak_planks");
});

test("TeamGoalController avoids a recently failed movement target and retries after cooldown", () => {
  let now = 1_000;
  const agents = [agent("leader-1", "LeaderBot", "leader", true)];
  const bots = new Map<string, BotHandle>([
    ["leader-1", fakeBot({ username: "LeaderBot", entity: entity("LeaderBot", { x: 0, y: 64, z: 0 }) })],
  ]);
  const controller = controllerFor(agents, bots, () => now);
  const leader = agents[0] as AgentConfig;

  const firstPlan = controller.plan({
    agent: leader,
    perception: perception("leader-1"),
    goal: "build a village",
  });
  const failedPosition = firstPlan.action?.params.position as Position;

  controller.recordActionResult(actionResult("leader-1", "move_to", false));

  const retryPlan = controller.plan({
    agent: leader,
    perception: perception("leader-1"),
    goal: "build a village",
  });
  const retryPosition = retryPlan.action?.params.position as Position;

  assert.notDeepEqual(retryPosition, failedPosition);
  assert.equal(retryPosition.x, 8);

  now += 21_000;
  const afterCooldownPlan = controller.plan({
    agent: leader,
    perception: perception("leader-1"),
    goal: "build a village",
  });

  assert.deepEqual(afterCooldownPlan.action?.params.position, failedPosition);
});

test("TeamGoalController logs a clear reason when no deterministic action exists", () => {
  const messages: string[] = [];
  const agents = [
    agent("leader-1", "LeaderBot", "leader", true),
    agent("farmer-1", "FarmerBot", "farmer"),
  ];
  const bots = new Map<string, BotHandle>([
    ["farmer-1", fakeBot({ username: "FarmerBot", entity: entity("FarmerBot", { x: 0, y: 64, z: 0 }) })],
  ]);
  const controller = controllerFor(agents, bots, undefined, (message) => messages.push(message));

  const plan = controller.plan({
    agent: agents[1] as AgentConfig,
    perception: perception("farmer-1"),
    goal: "build a village",
  });

  assert.equal(plan.action, undefined);
  assert.match(messages[0] ?? "", /\[live-autonomy\] farmer-1 no action: .*no visible resources.*no site anchor.*no placeable inventory/);
});

test("TeamGoalController uses memory to avoid duplicate non-miner resource work", () => {
  const agents = [
    agent("leader-1", "LeaderBot", "leader", true),
    agent("miner-1", "MinerBot", "miner"),
    agent("builder-1", "BuilderBot", "builder"),
  ];
  const bots = new Map<string, BotHandle>([
    ["leader-1", fakeBot({ username: "LeaderBot", entity: entity("LeaderBot", { x: 0, y: 64, z: 0 }) })],
    ["miner-1", fakeBot({ username: "MinerBot", entity: entity("MinerBot", { x: 29, y: 64, z: 0 }) })],
    ["builder-1", fakeBot({
      username: "BuilderBot",
      entity: entity("BuilderBot", { x: 29, y: 64, z: 0 }),
      collectBlock: { async collect() {} },
    })],
  ]);
  const { controller, memory } = controllerAndMemoryFor(agents, bots);

  controller.plan({
    agent: agents[0] as AgentConfig,
    perception: perception("leader-1"),
    goal: "build a village and gather materials",
  });
  memory.recordActivity("miner-1", { action: "mine_block", params: { block: "stone" } });

  const builderPlan = controller.plan({
    agent: agents[2] as AgentConfig,
    perception: perception("builder-1", {
      visibleBlocks: [
        {
          id: "stone-1",
          type: "stone",
          position: { x: 30, y: 64, z: 0 },
          safe: true,
        },
      ],
      nearbyEntities: [
        {
          id: "drop-1",
          type: "cobblestone",
          position: { x: 31, y: 64, z: 0 },
          hostile: false,
        },
      ],
    }),
    goal: "build a village and gather materials",
  });

  assert.equal(builderPlan.action?.action, "collect_item");
  assert.notEqual(builderPlan.action?.action, "mine_block");
});

test("TeamGoalController writes activity memory for returned physical actions", () => {
  const agents = [
    agent("leader-1", "LeaderBot", "leader", true),
    agent("miner-1", "MinerBot", "miner"),
    agent("farmer-1", "FarmerBot", "farmer"),
    agent("collector-1", "CollectorBot", "farmer"),
    agent("guard-1", "GuardBot", "guard"),
  ];
  const bots = new Map<string, BotHandle>([
    ["leader-1", fakeBot({ username: "LeaderBot", entity: entity("LeaderBot", { x: 0, y: 64, z: 0 }) })],
    ["miner-1", fakeBot({ username: "MinerBot", entity: entity("MinerBot", { x: 29, y: 64, z: 0 }) })],
    ["farmer-1", placeBot("FarmerBot", { x: 29, y: 64, z: 0 }, ["oak_planks"])],
    ["collector-1", fakeBot({
      username: "CollectorBot",
      entity: entity("CollectorBot", { x: 29, y: 64, z: 0 }),
      collectBlock: { async collect() {} },
    })],
    ["guard-1", fakeBot({ username: "GuardBot", entity: entity("GuardBot", { x: 29, y: 64, z: 0 }) })],
  ]);
  const { controller, memory } = controllerAndMemoryFor(agents, bots);

  controller.plan({
    agent: agents[0] as AgentConfig,
    perception: perception("leader-1"),
    goal: "build a village and gather materials",
  });
  controller.plan({
    agent: agents[1] as AgentConfig,
    perception: perception("miner-1", {
      visibleBlocks: [{ id: "stone-1", type: "stone", position: { x: 30, y: 64, z: 0 }, safe: true }],
    }),
    goal: "build a village and gather materials",
  });
  controller.plan({
    agent: agents[2] as AgentConfig,
    perception: perception("farmer-1"),
    goal: "build a village and gather materials",
  });
  controller.plan({
    agent: agents[3] as AgentConfig,
    perception: perception("collector-1", {
      nearbyEntities: [{ id: "drop-1", type: "cobblestone", position: { x: 31, y: 64, z: 0 }, hostile: false }],
    }),
    goal: "build a village and gather materials",
  });
  controller.plan({
    agent: agents[4] as AgentConfig,
    perception: perception("guard-1", {
      nearbyPlayers: [{ id: "steve", name: "Steve", distance: 4, protected: false, threatening: true }],
    }),
    goal: "kill Steve",
    attackTargetUsername: "Steve",
  });

  const summary = memory.recentForAgent("farmer-1", { maxEntries: 20, log: false })?.summary ?? "";
  assert.match(summary, /leader-1 doing move_to/);
  assert.match(summary, /miner-1 doing mine_block stone/);
  assert.match(summary, /farmer-1 doing place_block oak_planks/);
  assert.match(summary, /collector-1 doing collect_item drop-1/);
  assert.match(summary, /guard-1 doing attack_entity Steve/);
});

function controllerFor(
  agents: AgentConfig[],
  bots: Map<string, BotHandle>,
  now?: () => number,
  log?: (message: string) => void,
): TeamGoalController {
  const subteams = new SubteamDirectory(agents);
  return new TeamGoalController({
    subteams,
    getBot: (agentId) => bots.get(agentId),
    now,
    log,
  });
}

function controllerAndMemoryFor(
  agents: AgentConfig[],
  bots: Map<string, BotHandle>,
): { controller: TeamGoalController; memory: TeamMemoryStore } {
  const subteams = new SubteamDirectory(agents);
  const memory = new TeamMemoryStore({ subteams, log: () => {} });
  return {
    controller: new TeamGoalController({
      subteams,
      getBot: (agentId) => bots.get(agentId),
      memory,
      log: () => {},
    }),
    memory,
  };
}

function agent(id: string, username: string, role: string, leader = false): AgentConfig {
  return {
    id,
    name: id,
    account: { username, auth: "offline" },
    role,
    team: "ai",
    subteam: "oak",
    leader,
    mode: "routine",
    routine: role,
    allowedActions: ALL_ACTIONS,
    providerRef: "mock",
    visibility: "ai",
  };
}

function entity(username: string, position: Position) {
  return {
    id: username,
    type: "player",
    username,
    position,
  };
}

function placeBot(username: string, position: Position, inventory: string[]): BotHandle {
  return fakeBot({
    username,
    entity: entity(username, position),
    inventory: {
      items: () => inventory.map((name) => ({ name, count: 8 })),
      emptySlotCount: () => 1,
    },
    blockAt(target) {
      if (target.y < position.y) {
        return { name: "grass_block", position: target, diggable: true };
      }
      return { name: "air", position: target, diggable: false };
    },
  });
}

function perception(
  agentId: string,
  overrides: Partial<PerceptionSnapshot> = {},
): PerceptionSnapshot {
  return {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
    ...overrides,
  };
}

function actionResult(agentId: string, action: string, ok: boolean): ActionResult {
  return {
    requestId: `${agentId}-${action}`,
    agentId,
    action,
    ok,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
  };
}
