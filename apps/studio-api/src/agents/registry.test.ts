import test from "node:test";
import assert from "node:assert/strict";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { AgentRegistry } from "./registry";

test("AgentRegistry can register, fetch, list, and update mode", () => {
  const registry = new AgentRegistry();
  registry.register(agent("agent-b", "Bia"));
  registry.register(agent("agent-a", "Ada"));

  assert.equal(registry.get("agent-a")?.mode, "routine");
  assert.deepEqual(registry.list().map((entry) => entry.id), ["agent-a", "agent-b"]);

  const updated = registry.updateMode("agent-a", "acting");
  assert.equal(updated.mode, "acting");
  assert.equal(registry.get("agent-a")?.mode, "acting");
});

function agent(id: string, name: string): AgentConfig {
  return {
    id,
    name,
    account: {
      username: `${name}Bot`,
      auth: "offline",
    },
    role: "guard",
    team: "blue",
    mode: "routine",
    allowedActions: ["idle"],
    providerRef: "local",
  };
}
