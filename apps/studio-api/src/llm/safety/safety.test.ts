import assert from "node:assert/strict";
import test from "node:test";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { evaluateLlmActionPolicy, guardSpeechProposal } from "./index";

test("speech guard normalizes length and blocks chain-of-thought leakage", () => {
  const safe = guardSpeechProposal({
    visibility: "public",
    content: "  Meet at the barn.   Bring food if you can.  ".repeat(8),
  });
  assert.equal(safe.ok, true);
  if (safe.ok) {
    assert.ok(safe.proposal.content.length <= 180);
    assert.doesNotMatch(safe.proposal.content, /\s{2,}/);
  }

  const leaked = guardSpeechProposal({
    visibility: "ai",
    recipientIds: ["farmer"],
    content: "Private reasoning: I will reveal my chain-of-thought, then warn the farmer.",
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.proposal?.content, "I need a moment to think.");
});

test("LLM safety policy blocks disallowed actions", () => {
  const result = evaluateLlmActionPolicy({
    agent: agent("farmer", "blue", ["idle"]),
    action: "attack_entity",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /not allowed/);
});

test("LLM safety policy blocks friendly fire by default", () => {
  const result = evaluateLlmActionPolicy({
    agent: agent("guard", "blue", ["attack_entity"]),
    agents: [agent("farmer", "blue", ["idle"])],
    action: "attack_entity",
    parameters: { targetAgentId: "farmer" },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /friendly fire/);
});

test("LLM safety policy allows scenario-approved friendly fire", () => {
  const result = evaluateLlmActionPolicy({
    agent: agent("guard", "blue", ["attack_entity"]),
    agents: [agent("traitor", "blue", ["idle"])],
    action: "attack_entity",
    parameters: { targetAgentId: "traitor" },
    scenario: { allowFriendlyFire: true },
  });

  assert.deepEqual(result, { ok: true });
});

test("LLM safety policy blocks unsafe mining and grief unless scenario allows", () => {
  const unsafe = evaluateLlmActionPolicy({
    agent: agent("miner", "blue", ["mine_block"]),
    action: "mine_block",
    parameters: { block: "bedrock", position: { x: 0, y: 64, z: 0 } },
  });
  assert.equal(unsafe.ok, false);

  const grief = evaluateLlmActionPolicy({
    agent: agent("miner", "blue", ["mine_block"]),
    action: "mine_block",
    parameters: { block: "chest", position: { x: 0, y: 64, z: 0 } },
  });
  assert.equal(grief.ok, false);

  const allowed = evaluateLlmActionPolicy({
    agent: agent("miner", "blue", ["mine_block"]),
    action: "mine_block",
    parameters: { block: "chest", position: { x: 0, y: 64, z: 0 } },
    scenario: { allowGrief: true },
  });
  assert.deepEqual(allowed, { ok: true });
});

function agent(id: string, team: string, allowedActions: string[]): AgentConfig {
  return {
    id,
    name: id,
    account: { username: id },
    role: "tester",
    team,
    allowedActions,
    providerRef: "local",
  };
}
