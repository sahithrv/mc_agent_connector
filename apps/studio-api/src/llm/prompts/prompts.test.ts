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

test("prompt context renders recent action results compactly and preserves failure reasons", () => {
  const context = buildPromptContext({
    agent: {
      id: "miner-1",
      name: "Rook",
      role: "miner",
      team: "village",
      routine: "miner",
      allowedActions: ["idle", "move_to", "mine_block", "craft_item"],
    },
    staticPersona: { identity: "Rook is a practical miner." },
    recentActionResults: [
      {
        action: "collect_item",
        ok: true,
        targetKey: "item:stick",
        completedAt: "2026-06-12T00:00:00.000Z",
      },
      {
        action: "mine_block",
        ok: false,
        params: { block: "iron_ore", position: { x: 12, y: 64, z: -9 } },
        error: "missing valid tool for block: iron_ore",
        requestedBy: "llm",
        completedAt: "2026-06-12T00:00:01.000Z",
      },
      {
        action: "craft_item",
        ok: false,
        params: { item: "wooden_pickaxe" },
        error: "no craftable recipe for wooden_pickaxe",
      },
      {
        action: "move_to",
        ok: false,
        params: { position: { x: 30, y: 64, z: 10 } },
        error: "No path to goal",
      },
    ],
    maxChars: 2_000,
  });

  assert.ok(context.contextText.length <= 2_000);
  assert.match(context.contextText, /RECENT_ACTION_RESULTS/);
  assert.match(context.contextText, /mine_block target=iron_ore@12,64,-9 ok=false/);
  assert.match(context.contextText, /error="missing valid tool for block: iron_ore"/);
  assert.match(context.contextText, /craft_item target=wooden_pickaxe ok=false error="no craftable recipe for wooden_pickaxe"/);
  assert.match(context.contextText, /move_to target=30,64,10 ok=false error="No path to goal"/);
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
  assert.match(decision, /ACTION_PARAMETER_RULES/);
  assert.match(decision, /move_to, mine_block, and place_block require/);
  assert.match(decision, /Use relationships and memories/);
  assert.match(decision, /do not repeat the same failed action-target pair/);
  assert.match(decision, /missing tool\/material/);
  assert.match(reflection, /only deltas/);
  assert.match(reflection, /Do not rewrite the full static persona/);
  assert.match(leader, /under 240 characters/);
  assert.doesNotMatch(combined, /mineflayer|bot\.|pathfinder|collectBlock|\.dig|\.attack/i);
});
