import test from "node:test";
import assert from "node:assert/strict";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { SubteamDirectory } from "./subteams";

test("SubteamDirectory builds leaders and private team recipients", () => {
  const directory = new SubteamDirectory([
    agent("oak-leader", "OakLeader", "oak", true),
    agent("oak-miner", "OakMiner", "oak"),
    agent("iron-leader", "IronLeader", "iron", true),
    agent("iron-farmer", "IronFarmer", "iron"),
  ]);

  assert.equal(directory.leaderUsernameForAgent("oak-miner"), "OakLeader");
  assert.deepEqual(directory.teammates("oak-miner", false), ["oak-leader"]);
  assert.deepEqual(directory.resolveRecipients("oak-miner", {}), ["oak-leader"]);
  assert.deepEqual(directory.resolveRecipients("oak-miner", { subteamId: "iron" }), [
    "iron-farmer",
    "iron-leader",
  ]);
  assert.deepEqual(directory.resolveRecipients("oak-miner", { leadersOnly: true }), [
    "iron-leader",
    "oak-leader",
  ]);
});

function agent(id: string, username: string, subteam: string, leader = false): AgentConfig {
  return {
    id,
    name: id,
    account: { username, auth: "offline" },
    role: leader ? "guard" : "miner",
    team: "ai",
    subteam,
    leader,
    mode: "routine",
    routine: leader ? "guard" : "miner",
    allowedActions: ["idle", "chat_ai_private"],
    providerRef: "mock",
    visibility: "ai",
  };
}
