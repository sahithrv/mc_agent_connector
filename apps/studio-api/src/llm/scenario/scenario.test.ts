import assert from "node:assert/strict";
import test from "node:test";

import { buildScenarioPromptContext, renderScenarioPromptContext } from "./index";

test("scenario prompt scopes secret roles to intended agents and director", () => {
  const farmer = buildScenarioPromptContext({
    scenario: scenario(),
    viewerAgentId: "farmer",
    premise: "Survive the village split.",
    currentEpisodeGoal: "Find food before night.",
    directorConstraints: ["Do not reveal hidden traitors."],
  });

  assert.deepEqual(
    farmer.visibleSecretRoles.map((secret) => `${secret.agentId}:${secret.role}`),
    ["traitor:spy"],
  );
  assert.equal(renderScenarioPromptContext(farmer).includes("miner=traitor"), false);

  const director = buildScenarioPromptContext({
    scenario: scenario(),
    viewerAgentId: "director",
    viewerRole: "director",
  });
  assert.deepEqual(
    director.visibleSecretRoles.map((secret) => secret.agentId).sort(),
    ["miner", "traitor"],
  );
});

test("scenario prompt includes human team assignments without making unaffiliated humans allies", () => {
  const context = buildScenarioPromptContext({
    scenario: scenario(),
    viewerAgentId: "farmer",
    humans: [
      { id: "human-1", username: "Alex", teamId: "blue" },
      { id: "human-2", username: "Guest" },
      { id: "rec-1", username: "CamOp", isRecorder: true },
    ],
  });

  assert.deepEqual(context.alliedHumanUsernames, ["Alex"]);
  assert.deepEqual(context.unaffiliatedHumanUsernames, ["Guest"]);
  assert.deepEqual(context.recorderUsernames, ["CamOp"]);

  const rendered = renderScenarioPromptContext(context);
  assert.match(rendered, /Allied humans: Alex/);
  assert.match(rendered, /Unaffiliated humans are present but not allies: Guest/);
  assert.match(rendered, /Recorders observe only/);
});

function scenario() {
  return {
    id: "demo",
    name: "Demo",
    teams: [
      { id: "blue", agentIds: ["farmer", "miner", "traitor"] },
      { id: "red", agentIds: ["guard"] },
    ],
    roles: [
      { agentId: "farmer", role: "farmer", team: "blue" },
      { agentId: "miner", role: "miner", team: "blue" },
      { agentId: "traitor", role: "guard", team: "blue" },
    ],
    startingGoals: [],
    secretRoles: [
      { agentId: "miner", role: "traitor", visibleTo: ["director"] },
      { agentId: "traitor", role: "spy", visibleTo: ["farmer"] },
    ],
    directorTriggers: [],
  };
}
