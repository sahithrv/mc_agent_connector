import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig, Position } from "@mc-ai-video/contracts";

import { fakeBot } from "../actions/test-helpers";
import type { PerceptionSnapshot } from "../routines";
import { BlueprintRegistry } from "./blueprints";
import { LLMRequestQueue } from "./llm-request-queue";
import { FlankingEngine } from "./tactics";
import { AgentState, TacticalRole, TeamMemory } from "./team-memory";
import { CompetitiveTeamOrchestrator } from "./team-orchestrator";

test("BlueprintRegistry creates varied village plans per structure type", () => {
  const registry = BlueprintRegistry.withDefaults();
  const plan = registry.createVillagePlan({ residential: 3, farm: 2 }, () => 0);

  assert.equal(plan.length, 5);
  assert.equal(new Set(plan.filter((item) => item.type === "residential").map((item) => item.id)).size, 3);
  assert.equal(new Set(plan.filter((item) => item.type === "farm").map((item) => item.id)).size, 2);
});

test("TeamMemory tracks village state, rebalances roles, and transitions phases on major events", () => {
  const registry = BlueprintRegistry.withDefaults();
  const gothicHouse = registry.get("residential:gothic-house");
  const basicFarm = registry.get("farm:basic-wheat");
  assert.ok(gothicHouse);
  assert.ok(basicFarm);
  const blueprints = [gothicHouse, basicFarm];
  const memory = new TeamMemory({
    teamId: "red",
    agentIds: ["builder-1", "gatherer-1", "scout-1"],
    blueprints,
    initialResources: { cobblestone: 1 },
    now: () => 100,
  });
  const phaseChanges: AgentState[] = [];
  const depleted: string[] = [];
  memory.on("phase.changed", (event) => phaseChanges.push(event.next));
  memory.on("resources.depleted", (event) => depleted.push(event.item));

  memory.updateSharedResource("cobblestone", -1);
  assert.ok(depleted.includes("cobblestone"));

  for (const blueprint of blueprints) {
    memory.claimNextBlueprint("builder-1");
    memory.completeBlueprint("builder-1", blueprint.id);
  }

  assert.equal(memory.currentPhase(), AgentState.HUNT_PHASE);
  memory.spotPlayer({ x: 20, y: 64, z: 20 }, "high", "HumanPlayer");

  assert.equal(memory.currentPhase(), AgentState.KILL_PHASE);
  assert.deepEqual(phaseChanges, [AgentState.HUNT_PHASE, AgentState.KILL_PHASE]);
});

test("FlankingEngine assigns aggro and side flanks away from straight-line player rushes", () => {
  const engine = new FlankingEngine({ now: () => 5, aggroRange: 3, flankRadius: 8 });
  const threat = {
    playerLastSeen: { x: 0, y: 64, z: 0 },
    lastSightingTimestamp: 1,
    alertLevel: "high" as const,
  };
  const positions = new Map<string, Position>([
    ["a", { x: 10, y: 64, z: 0 }],
    ["b", { x: 10, y: 64, z: 0 }],
    ["c", { x: 10, y: 64, z: 0 }],
  ]);

  const assignments = engine.assign(["c", "b", "a"], threat, positions);

  assert.equal(assignments[0]?.agentId, "a");
  assert.equal(assignments[0]?.role, TacticalRole.AGGRO);
  assert.ok(assignments.some((assignment) => assignment.role === TacticalRole.FLANK_LEFT));
  assert.ok(assignments.some((assignment) => assignment.role === TacticalRole.FLANK_RIGHT));
  for (const assignment of assignments) {
    assert.notDeepEqual(assignment.targetPosition, threat.playerLastSeen);
  }
});

test("LLMRequestQueue staggers requests and validates exact response shape without throwing", async () => {
  const sleeps: number[] = [];
  const queue = new LLMRequestQueue({
    minDelayMs: 200,
    maxDelayMs: 500,
    random: () => 0.5,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  const first = queue.enqueue({
    agentId: "agent-1",
    reason: "player.spotted",
    async execute() {
      return { nextBestAction: "flank left", targetCoordinates: [1, 64, 2] };
    },
  });
  const second = queue.enqueue({
    agentId: "agent-2",
    reason: "player.spotted",
    async execute() {
      return { nextBestAction: "bad", targetCoordinates: ["x", 64, 2] };
    },
  });

  const results = await Promise.all([first, second]);

  assert.equal(results[0]?.ok, true);
  assert.equal(results[1]?.ok, false);
  assert.deepEqual(sleeps, [350]);
});

test("CompetitiveTeamOrchestrator returns deterministic non-LLM tactical actions", () => {
  const registry = BlueprintRegistry.withDefaults();
  const [blueprint] = registry.createVillagePlan({ residential: 1 }, () => 0);
  assert.ok(blueprint);

  const memory = new TeamMemory({
    teamId: "red",
    agentIds: ["agent-1"],
    blueprints: [blueprint],
    initialResources: { cobblestone: 100, oak_planks: 100, glass: 100, torch: 100 },
  });
  memory.claimNextBlueprint("agent-1");
  memory.completeBlueprint("agent-1", blueprint.id);
  memory.spotPlayer({ x: 10, y: 64, z: 10 }, "high", "HumanPlayer");

  const orchestrator = new CompetitiveTeamOrchestrator({ memory });
  const action = orchestrator.planNextAction({
    agent: agent("agent-1"),
    bot: fakeBot({
      username: "AgentOne",
      entity: { id: "agent-1", type: "player", username: "AgentOne", position: { x: 0, y: 64, z: 0 } },
    }),
    perception: perception("agent-1"),
  });

  assert.equal(action?.action, "move_to");
  assert.equal(action?.requestedBy, "competitive-orchestrator");
});

test("CompetitiveTeamOrchestrator assigns kill-phase tactics across the full team", () => {
  const registry = BlueprintRegistry.withDefaults();
  const blueprint = registry.get("residential:gothic-house");
  assert.ok(blueprint);
  const memory = new TeamMemory({
    teamId: "red",
    agentIds: ["a", "b", "c"],
    blueprints: [blueprint],
    initialResources: { cobblestone: 100, oak_planks: 100, glass: 100, torch: 100 },
  });
  memory.claimNextBlueprint("a");
  memory.completeBlueprint("a", blueprint.id);
  memory.spotPlayer({ x: 0, y: 64, z: 0 }, "high", "HumanPlayer");

  const orchestrator = new CompetitiveTeamOrchestrator({ memory });
  orchestrator.planNextAction({
    agent: agent("c"),
    bot: fakeBot({
      username: "c",
      entity: { id: "c", type: "player", username: "c", position: { x: 10, y: 64, z: 0 } },
    }),
    perception: perception("c"),
  });

  assert.equal(memory.tacticFor("a")?.role, TacticalRole.AGGRO);
  assert.ok([TacticalRole.FLANK_LEFT, TacticalRole.FLANK_RIGHT].includes(memory.tacticFor("b")?.role as TacticalRole));
  assert.ok([TacticalRole.FLANK_LEFT, TacticalRole.FLANK_RIGHT].includes(memory.tacticFor("c")?.role as TacticalRole));
});

test("CompetitiveTeamOrchestrator moves gatherers to search when mining is not available", () => {
  const registry = BlueprintRegistry.withDefaults();
  const blueprint = registry.get("residential:gothic-house");
  assert.ok(blueprint);
  const memory = new TeamMemory({
    teamId: "red",
    agentIds: ["farmer-1"],
    blueprints: [blueprint],
  });
  const orchestrator = new CompetitiveTeamOrchestrator({ memory });

  const action = orchestrator.planNextAction({
    agent: agent("farmer-1", ["idle", "move_to", "collect_item", "place_block", "attack_entity"]),
    bot: fakeBot({
      username: "farmer-1",
      entity: { id: "farmer-1", type: "player", username: "farmer-1", position: { x: 0, y: 64, z: 0 } },
    }),
    perception: perception("farmer-1"),
  });

  assert.equal(action?.action, "move_to");
  assert.match(String(action?.params.reason), /searching for missing village materials/);
});

test("CompetitiveTeamOrchestrator builders search beyond occupied adjacent cells", () => {
  const registry = BlueprintRegistry.withDefaults();
  const blueprint = registry.get("residential:gothic-house");
  assert.ok(blueprint);
  const memory = new TeamMemory({
    teamId: "red",
    agentIds: ["builder-1", "gatherer-1"],
    blueprints: [blueprint],
    initialResources: { cobblestone: 100, oak_planks: 100, glass: 100, torch: 100 },
  });
  const orchestrator = new CompetitiveTeamOrchestrator({ memory });

  const action = orchestrator.planNextAction({
    agent: agent("builder-1"),
    bot: fakeBot({
      username: "builder-1",
      entity: { id: "builder-1", type: "player", username: "builder-1", position: { x: 0, y: 64, z: 0 } },
      inventory: {
        items: () => [{ name: "oak_planks", count: 64 }],
        emptySlotCount: () => 1,
      },
      blockAt(target) {
        if (target.y < 64) return { name: "grass_block", position: target, diggable: true };
        return Math.max(Math.abs(target.x), Math.abs(target.z)) <= 1
          ? { name: "cobblestone", position: target, diggable: true }
          : { name: "air", position: target, diggable: false };
      },
      async equip() {},
      async placeBlock() {},
    }),
    perception: perception("builder-1"),
  });

  assert.equal(action?.action, "place_block");
  const position = action?.params.position as Position | undefined;
  assert.ok(position);
  assert.equal(Math.max(Math.abs(position.x), Math.abs(position.z)), 2);
});

function agent(id: string, allowedActions = ["move_to", "mine_block", "collect_item", "place_block", "attack_entity"]): AgentConfig {
  return {
    id,
    name: id,
    account: { username: id, auth: "offline" },
    role: "builder",
    team: "red",
    subteam: "red",
    mode: "routine",
    routine: "builder",
    allowedActions,
    providerRef: "mock",
    visibility: "ai",
  };
}

function perception(agentId: string): PerceptionSnapshot {
  return {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0, food: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  };
}
