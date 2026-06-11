import type { AgentConfig, AiChatMessage, GameEvent } from "@mc-ai-video/contracts";

import { StudioStore } from "./store";

describe("StudioStore", () => {
  it("sets session and agents from shared contracts", () => {
    const store = new StudioStore();
    const agent: AgentConfig = {
      id: "farmer-1",
      name: "Farmer 1",
      account: { username: "farmer_1", auth: "offline" },
      role: "farmer",
      mode: "routine",
      allowedActions: ["idle"],
      providerRef: "local",
    };

    store.setSession({
      id: "session-1",
      name: "Demo",
      startedAt: "2026-06-10T00:00:00.000Z",
      status: "running",
    });
    store.setAgents([agent]);

    expect(store.getSnapshot().session?.id).toBe("session-1");
    expect(store.getSnapshot().agents[0]?.role).toBe("farmer");
    expect(store.getSnapshot().health.bots.total).toBe(1);
  });

  it("upserts agent state from dashboard envelopes", () => {
    const store = new StudioStore();

    store.applyEnvelope({
      type: "agent.state",
      payload: {
        agentId: "guard-1",
        mode: "planning",
        currentTask: "Watch east gate",
        updatedAt: "2026-06-10T00:01:00.000Z",
      },
    });

    expect(store.getSnapshot().agents).toHaveLength(1);
    expect(store.getSnapshot().agents[0]?.mode).toBe("planning");
    expect(store.getSnapshot().health.bots.connected).toBe(1);
  });

  it("stores newest events and chat first", () => {
    const store = new StudioStore();
    const event: GameEvent = {
      id: "event-1",
      type: "diamond_found",
      severity: 4,
      visibility: "ai",
      payload: {},
      timestamp: "2026-06-10T00:02:00.000Z",
    };
    const message: AiChatMessage = {
      id: "chat-1",
      senderId: "miner-1",
      recipientIds: ["guard-1"],
      visibility: "ai",
      content: "Diamonds near ravine",
      timestamp: "2026-06-10T00:03:00.000Z",
    };

    store.applyEnvelope({ type: "game.event", payload: event });
    store.applyEnvelope({ type: "chat.message", payload: message });

    expect(store.getSnapshot().events[0]?.id).toBe("event-1");
    expect(store.getSnapshot().chat[0]?.content).toContain("Diamonds");
  });
});
