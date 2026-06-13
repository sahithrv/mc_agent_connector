import test from "node:test";
import assert from "node:assert/strict";

import type {
  RuntimeAgentControlResult,
  RuntimeAgentSnapshot,
  RuntimeServiceSnapshot,
} from "@mc-ai-video/contracts";

import { StudioEventBus } from "../events/bus";
import { createApp } from "../server/app";
import type { RuntimeController } from "./routes";

test("runtime status reports unsupported launch without a live controller", async () => {
  const app = createApp({ studioConfig: testConfig(), agents: [agent("farmer-1")] });

  const status = await app.inject({ method: "GET", url: "/runtime/status" });
  const launch = await app.inject({
    method: "POST",
    url: "/runtime/launch",
    payload: { agentIds: ["farmer-1"] },
  });

  assert.equal(status.statusCode, 200);
  assert.equal(status.json().capabilities.launch, false);
  assert.equal(status.json().agents[0].connectionStatus, "disconnected");
  assert.equal(launch.statusCode, 501);
  await app.close();
});

test("runtime launch delegates to controller and publishes scenario goal", async () => {
  const eventBus = new StudioEventBus();
  const events: string[] = [];
  eventBus.subscribe("game.event", (event) => events.push(event.type));
  const launched: string[][] = [];
  const controller: RuntimeController = {
    status: () => [runtimeAgent("farmer-1", "disconnected")],
    minecraft: (): RuntimeServiceSnapshot => ({ status: "online", message: "test server" }),
    launch: async (input): Promise<RuntimeAgentControlResult[]> => {
      launched.push(input.agentIds);
      return [
        {
          agentId: "farmer-1",
          ok: true,
          connectionStatus: "connected",
          mode: "routine",
        },
      ];
    },
    stop: async (agentId): Promise<RuntimeAgentControlResult> => ({
      agentId,
      ok: true,
      connectionStatus: "disconnected",
      mode: "paused",
    }),
  };
  const app = createApp({
    studioConfig: testConfig(),
    agents: [agent("farmer-1")],
    eventBus,
    runtimeController: controller,
  });

  const response = await app.inject({
    method: "POST",
    url: "/runtime/launch",
    payload: {
      agentIds: ["farmer-1"],
      scenarioGoal: "Build a safe base before nightfall",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.deepEqual(launched, [["farmer-1"]]);
  assert.deepEqual(events, ["chat.leader_command"]);
  await app.close();
});

function runtimeAgent(
  agentId: string,
  connectionStatus: RuntimeAgentSnapshot["connectionStatus"],
): RuntimeAgentSnapshot {
  return {
    agentId,
    mode: connectionStatus === "connected" ? "routine" : "paused",
    connectionStatus,
    hasBot: connectionStatus === "connected",
    updatedAt: new Date().toISOString(),
  };
}

function testConfig() {
  return {
    server: { host: "127.0.0.1", port: 0, logger: false },
    tickRates: { schedulerMs: 1000, routineMs: 2000, perceptionMs: 500 },
    database: { path: ":memory:" },
    llm: { maxConcurrency: 1 },
  };
}

function agent(id: string) {
  return {
    id,
    name: id,
    account: { username: id },
    role: "farmer",
    team: "ai",
    subteam: "oak",
    allowedActions: ["idle", "chat_ai_private"],
    providerRef: "deepseek",
  };
}
