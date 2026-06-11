import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDecisionPrompt,
  buildLeaderSummaryPrompt,
  buildPersonaSystemPrompt,
  buildPromptContext,
  buildReflectionPrompt,
} from "./index";

test("prompt context separates static persona, dynamic state, and respects budget", () => {
  const context = buildPromptContext({
    agent: {
      id: "farmer-1",
      name: "Mira",
      role: "farmer",
      team: "village",
      routine: "farmer",
      allowedActions: ["idle", "chat_ai_private"],
    },
    staticPersona: {
      identity: "Mira is a careful village farmer.",
      speakingStyle: "plain and brief",
      values: ["protect crops", "help allies"],
    },
    dynamicState: {
      health: 12,
      activeGoal: "finish harvest",
      emotionalState: "uneasy",
    },
    memories: Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      summary: `memory ${index} about village plans and crop duties`,
      importance: index,
    })),
    maxChars: 700,
  });

  assert.ok(context.contextText.length <= 700);
  assert.match(context.staticPersonaText, /careful village farmer/);
  assert.doesNotMatch(context.staticPersonaText, /health=12/);
  assert.match(context.dynamicStateText, /health=12/);
  assert.match(context.contextText, /STATIC_PERSONA/);
  assert.match(context.contextText, /DYNAMIC_STATE/);
});

test("persona and task prompts keep contracts compact and high level", () => {
  const context = buildPromptContext({
    agent: {
      id: "guard-1",
      name: "Bran",
      role: "guard",
      allowedActions: ["idle", "flee"],
    },
    staticPersona: { identity: "Bran is a loyal guard." },
    dynamicState: { health: 6, threatLevel: "high" },
    maxChars: 1_000,
  });

  const system = buildPersonaSystemPrompt({ identity: "Bran is a loyal guard." });
  const decision = buildDecisionPrompt({
    context,
    availableActions: ["idle: Pause briefly.", "flee: Move away from danger."],
  });
  const reflection = buildReflectionPrompt({
    context,
    majorEvent: "leader attacked farmer-1",
  });
  const leader = buildLeaderSummaryPrompt({
    context,
    plan: "guards escort farmers back to base",
    audienceAgentIds: ["farmer-1", "guard-2"],
  });
  const combined = [system, decision, reflection, leader].join("\n");

  assert.match(system, /Maintain this static persona/);
  assert.doesNotMatch(system, /health=6/);
  assert.match(decision, /AVAILABLE_ACTIONS/);
  assert.match(decision, /idle: Pause briefly/);
  assert.match(reflection, /only deltas/);
  assert.match(reflection, /Do not rewrite the full static persona/);
  assert.match(leader, /under 240 characters/);
  assert.doesNotMatch(combined, /mineflayer|bot\.|pathfinder|collectBlock|\.dig|\.attack/i);
});
