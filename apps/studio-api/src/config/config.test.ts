import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { defaultAgentsConfigDir, loadAgentConfigs } from "./agents";
import { defaultAgentActions } from "../agents/default-actions";
import { ConfigError } from "./errors";
import { loadStudioConfig } from "./studio";

test("loadStudioConfig accepts a valid config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-config-"));
  const filePath = join(dir, "studio.config.json");
  await writeFile(filePath, JSON.stringify(validStudioConfig()), "utf8");

  const config = await loadStudioConfig(filePath);

  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.port, 3100);
  assert.equal(config.llm.maxConcurrency, 2);
  assert.equal(config.plugin?.sharedSecret, "dev-local-secret");
});

test("loadStudioConfig rejects bad config with a readable field error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bad-studio-config-"));
  const filePath = join(dir, "studio.config.json");
  const badConfig: Record<string, any> = validStudioConfig();
  badConfig.server.port = "nope";
  await writeFile(filePath, JSON.stringify(badConfig), "utf8");

  await assert.rejects(
    () => loadStudioConfig(filePath),
    (error) => error instanceof ConfigError && error.message.includes("port must be an integer"),
  );
});

test("loadAgentConfigs loads valid agent configs deterministically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-config-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "b.json"), JSON.stringify(validAgent("agent-b", "Bia", "BiaBot")), "utf8");
  await writeFile(join(dir, "a.json"), JSON.stringify(validAgent("agent-a", "Ada", "AdaBot")), "utf8");

  const agents = await loadAgentConfigs(dir);

  assert.deepEqual(agents.map((agent) => agent.id), ["agent-a", "agent-b"]);
  assert.deepEqual(agents[0]?.allowedActions, ["idle", "chat_ai_private"]);
  assert.equal(agents[0]?.allowedActions.includes("mine_block"), false);
});

test("loadAgentConfigs uses default actions only when allowedActions is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-config-default-actions-"));
  await mkdir(dir, { recursive: true });
  const agent: Record<string, unknown> = validAgent("agent-a", "Ada", "AdaBot");
  delete agent.allowedActions;
  await writeFile(join(dir, "a.json"), JSON.stringify(agent), "utf8");

  const agents = await loadAgentConfigs(dir);

  assert.deepEqual(agents[0]?.allowedActions, defaultAgentActions());
});

test("default sample agent configs load 20 agents", async () => {
  const agents = await loadAgentConfigs(defaultAgentsConfigDir());

  assert.equal(agents.length, 20);
  assert.equal(agents.filter((agent) => agent.role === "farmer").length, 8);
  assert.equal(agents.filter((agent) => agent.role === "miner").length, 7);
  assert.equal(agents.filter((agent) => agent.role === "guard").length, 5);
  assert.deepEqual([...new Set(agents.map((agent) => agent.subteam))].sort(), [
    "ember",
    "iron",
    "oak",
    "river",
  ]);
  assert.equal(agents.filter((agent) => agent.leader === true).length, 4);
});

test("loadAgentConfigs rejects bad agent config before server start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bad-agent-config-"));
  await mkdir(dir, { recursive: true });
  const badAgent = validAgent("agent-a", "Ada", "AdaBot");
  badAgent.allowedActions = [];
  await writeFile(join(dir, "agent.json"), JSON.stringify(badAgent), "utf8");

  await assert.rejects(
    () => loadAgentConfigs(dir),
    (error) => error instanceof ConfigError && error.message.includes("allowedActions"),
  );
});

function validStudioConfig() {
  return {
    server: {
      host: "127.0.0.1",
      port: 3100,
      logger: false,
    },
    tickRates: {
      schedulerMs: 1000,
      routineMs: 2000,
      perceptionMs: 500,
    },
    database: {
      path: "./data/studio.sqlite",
    },
    llm: {
      maxConcurrency: 2,
    },
    plugin: {
      sharedSecret: "dev-local-secret",
    },
  };
}

function validAgent(id: string, name: string, username: string) {
  return {
    id,
    name,
    account: {
      username,
      auth: "offline",
    },
    role: "farmer",
    team: "ai",
    subteam: "test-team",
    mode: "routine",
    routine: "farmer",
    allowedActions: ["idle", "chat_ai_private"],
    providerRef: "local-planner",
    visibility: "ai",
  };
}
