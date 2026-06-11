import test from "node:test";
import assert from "node:assert/strict";

import type { ActionRequest, AgentConfig, GameEvent } from "@mc-ai-video/contracts";

import { defaultRoutines, type PerceptionSnapshot } from "../routines";
import { AgentScheduler } from "./scheduler";

test("3-agent leader farmer miner smoke test runs without Minecraft", async () => {
  const agents = [
    makeAgent("leader", "leader", undefined, ["chat_ai_private"]),
    makeAgent("farmer", "farmer", "farmer", ["harvest_crop", "idle"]),
    makeAgent("miner", "miner", "miner", ["mine_block", "chat_ai_private"]),
  ];
  const actions: string[] = [];
  const reflections: GameEvent[] = [];

  const scheduler = new AgentScheduler({
    agents,
    routines: defaultRoutines(),
    perception: {
      async snapshot(agent) {
        return smokePerception(agent.id);
      },
    },
    actions: {
      canRun: () => true,
      async run(_agent, request) {
        actions.push(`${request.agentId}:${request.action}`);
        return actionResult(request);
      },
    },
    planner: {
      async plan(agent, _perception, reason) {
        if (agent.id === "miner" && reason.type === "direct_mention") {
          return {
            action: {
              action: "chat_ai_private",
              params: {
                recipientIds: ["leader"],
                content: "I found the vein and will keep mining.",
              },
              timeoutMs: 1_000,
            },
          };
        }
        return {};
      },
    },
    reflection: {
      requestReflection(request) {
        reflections.push(request.event);
      },
    },
    config: {
      maxConcurrentActions: 2,
      maxPlanningSlots: 1,
      planningCooldownMs: 0,
    },
  });

  await scheduler.tick();
  await scheduler.waitForIdle();
  assert.deepEqual(actions.sort(), ["farmer:harvest_crop", "miner:mine_block"]);

  scheduler.handleEvent({
    id: "mention-1",
    type: "chat.direct_mention",
    actorId: "leader",
    targetId: "miner",
    severity: 4,
    visibility: "ai",
    payload: { mentionedAgentIds: ["miner"] },
    timestamp: new Date(0).toISOString(),
  });
  await scheduler.tick();
  await scheduler.waitForIdle();
  await scheduler.waitForIdle();

  assert.ok(actions.includes("miner:chat_ai_private"));
  assert.equal(reflections.length, 1);
});

function makeAgent(
  id: string,
  role: string,
  routine: string | undefined,
  allowedActions: string[],
): AgentConfig {
  return {
    id,
    name: id,
    account: { username: `${id}-bot`, auth: "offline" },
    role,
    team: "red",
    mode: "routine",
    routine,
    allowedActions,
    providerRef: "mock",
  };
}

function smokePerception(agentId: string): PerceptionSnapshot {
  const base: PerceptionSnapshot = {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  };

  if (agentId === "farmer") {
    return {
      ...base,
      inventory: { tools: ["hoe"], seeds: 3 },
      visibleBlocks: [
        {
          id: "wheat-1",
          type: "wheat_crop",
          mature: true,
          safe: true,
          position: { x: 2, y: 64, z: 2 },
        },
      ],
    };
  }

  if (agentId === "miner") {
    return {
      ...base,
      inventory: { tools: ["pickaxe"], seeds: 0 },
      visibleBlocks: [
        {
          id: "stone-1",
          type: "stone",
          safe: true,
          belowAgent: false,
          position: { x: 4, y: 62, z: 4 },
        },
      ],
    };
  }

  return base;
}

function actionResult(request: ActionRequest) {
  return {
    requestId: request.id,
    agentId: request.agentId,
    action: request.action,
    ok: true,
    startedAt: request.createdAt,
    completedAt: request.createdAt,
  };
}
