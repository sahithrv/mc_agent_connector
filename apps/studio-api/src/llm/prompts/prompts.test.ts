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

test("prompt context renders executable and blocked action affordances", () => {
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
    affordances: [
      {
        action: "craft_item",
        params: { item: "oak_planks", count: 4 },
        score: 0.95,
        reason: "logs in inventory; needed for tools",
        advancesGoal: true,
      },
      {
        action: "move_to",
        params: { position: { x: 22, y: 64, z: 17 } },
        score: 0.4,
        reason: "scout for trees/resources",
      },
      {
        action: "mine_block",
        params: { block: "iron_ore" },
        score: 0.86,
        reason: "iron ore visible",
        blocked: true,
        blockedReason: "missing stone_pickaxe",
        advancesGoal: true,
      },
      {
        action: "craft_item",
        params: { item: "stone_pickaxe" },
        score: 0.9,
        reason: "satisfy mining precondition",
        blocked: true,
        blockedReason: "need cobblestone",
      },
    ],
    maxChars: 2_000,
  });

  const decision = buildDecisionPrompt({
    context,
    availableActions: ["craft_item: Craft a needed item.", "mine_block: Mine a visible safe block."],
  });

  assert.match(context.contextText, /EXECUTABLE_NOW/);
  assert.match(context.contextText, /craft_item oak_planks x4 score=0\.95 reason="logs in inventory; needed for tools"/);
  assert.match(context.contextText, /move_to 22,64,17 score=0\.40 reason="scout for trees\/resources"/);
  assert.match(context.contextText, /BLOCKED_USEFUL_ACTIONS/);
  assert.match(context.contextText, /mine_block iron_ore blocked="missing stone_pickaxe"/);
  assert.match(context.contextText, /craft_item stone_pickaxe blocked="need cobblestone"/);
  assert.match(decision, /EXECUTABLE_NOW/);
  assert.match(decision, /Prefer EXECUTABLE_NOW actions that advance the goal/);
});

test("prompt context renders recovery guidance", () => {
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
    recovery: {
      stuck: true,
      reason: "same failed action-target pair repeated within 60 seconds: mine_block:world:1,64,2",
      blockedTargetKeys: ["mine_block:world:1,64,2"],
      hint: "Avoid retrying mine_block:world:1,64,2; craft a stone pickaxe or choose another target.",
    },
    maxChars: 2_000,
  });

  assert.match(context.contextText, /RECOVERY/);
  assert.match(context.contextText, /stuck=true/);
  assert.match(context.contextText, /blockedTargetKeys=mine_block:world:1,64,2/);
  assert.match(context.contextText, /choose a different action\/target or satisfy the blocker/);
});

test("prompt context renders current task plan compactly", () => {
  const context = buildPromptContext({
    agent: {
      id: "builder-1",
      name: "Ada",
      role: "builder",
      team: "village",
      routine: "builder",
      allowedActions: ["idle", "move_to", "place_block", "chat_ai_private"],
    },
    staticPersona: { identity: "Ada is a practical builder." },
    taskState: {
      goal: "Build a starter shelter",
      currentStepId: "place-walls",
      updatedAt: "2026-06-13T00:00:00.000Z",
      plan: [
        {
          id: "place-walls",
          description: "Place wall blocks near the claimed site",
          status: "active",
          nextAction: "place_block",
          successCondition: "first wall blocks are placed",
          target: { x: 4, y: 64, z: 2 },
        },
        {
          id: "report-blocker",
          description: "Ask leader for more planks if blocked",
          status: "pending",
          nextAction: "chat_ai_private",
          neededItems: { oak_planks: 6 },
        },
      ],
    },
    maxChars: 2_000,
  });
  const decision = buildDecisionPrompt({
    context,
    availableActions: ["place_block: Place a block.", "chat_ai_private: Send private AI chat."],
  });

  assert.match(context.contextText, /CURRENT_PLAN/);
  assert.match(context.contextText, /goal=Build a starter shelter/);
  assert.match(context.contextText, /\[active\] place-walls: Place wall blocks/);
  assert.match(context.contextText, /nextAction=place_block/);
  assert.match(context.contextText, /success="first wall blocks are placed"/);
  assert.match(context.contextText, /needs=oak_planksx6/);
  assert.match(decision, /CURRENT_PLAN/);
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
