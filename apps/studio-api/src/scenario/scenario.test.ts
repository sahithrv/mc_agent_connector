import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { ConfigError } from "../config/errors";
import { loadScenarioConfig } from "./loader";

test("loadScenarioConfig loads teams roles goals secrets and director triggers", async () => {
  const filePath = await writeScenario(validScenario());

  const scenario = await loadScenarioConfig(filePath);

  assert.equal(scenario.id, "demo");
  assert.equal(scenario.teams[0]?.agentIds.length, 3);
  assert.equal(scenario.roles[0]?.leader, true);
  assert.equal(scenario.startingGoals[0]?.priority, 2);
  assert.equal(scenario.secretRoles[0]?.role, "traitor");
  assert.equal(scenario.directorTriggers[0]?.severity, 4);
});

test("loadScenarioConfig reports exact nested field errors", async () => {
  const bad = validScenario();
  bad.teams[0].agentIds = ["leader", ""];
  const filePath = await writeScenario(bad);

  await assert.rejects(
    () => loadScenarioConfig(filePath),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("teams[0].agentIds[1] must be a non-empty string"),
  );
});

async function writeScenario(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scenario-"));
  const filePath = join(dir, "scenario.json");
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

function validScenario(): any {
  return {
    id: "demo",
    name: "Demo Scenario",
    teams: [
      {
        id: "red",
        name: "Red Team",
        agentIds: ["leader", "farmer", "miner"],
      },
    ],
    roles: [
      {
        agentId: "leader",
        role: "leader",
        team: "red",
        leader: true,
      },
      {
        agentId: "farmer",
        role: "farmer",
        team: "red",
        routine: "farmer",
      },
      {
        agentId: "miner",
        role: "miner",
        team: "red",
        routine: "miner",
      },
    ],
    startingGoals: [
      {
        agentId: "leader",
        goal: "coordinate the team",
        priority: 2,
      },
    ],
    secretRoles: [
      {
        agentId: "miner",
        role: "traitor",
        visibleTo: ["director"],
      },
    ],
    directorTriggers: [
      {
        id: "betrayal-clip",
        event: "agent.betrayal",
        action: "mark_clip",
        severity: 4,
      },
    ],
  };
}
