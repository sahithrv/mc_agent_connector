import type { EventSeverity } from "@mc-ai-video/contracts";

import { studioStore } from "../state/store";
import { createMockFetch } from "./api";
import { createMockStudioState, makeMockEvent, mockStudioData } from "./data";

export function shouldUseStudioMocks(): boolean {
  const flag = import.meta.env.VITE_STUDIO_MOCKS;
  if (flag !== undefined) {
    return !["0", "false", "off", "no"].includes(flag.toLowerCase());
  }

  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function startMockStudioRuntime(): () => void {
  studioStore.reset(createMockStudioState(mockStudioData));

  // Mock mode installs a fetch shim only for Studio API paths; all other requests keep the real client path.
  const originalFetch = window.fetch.bind(window);
  const mockFetch = createMockFetch(originalFetch);
  window.fetch = mockFetch;

  let tick = 0;
  const timer = window.setInterval(() => {
    tick += 1;
    const snapshot = studioStore.getSnapshot();
    const actor = snapshot.agents[tick % snapshot.agents.length];
    const target = snapshot.agents[(tick + 5) % snapshot.agents.length];

    if (!actor || !target) {
      return;
    }

    studioStore.applyEnvelope({
      type: "game.event",
      payload: makeMockEvent({
        id: `mock-live-${tick}`,
        type: tick % 3 === 0 ? "minecraft.chat.public" : "agent.task.updated",
        actorId: actor.id,
        targetId: target.id,
        severity: (((tick + 2) % 5) + 1) as EventSeverity,
        visibility: tick % 3 === 0 ? "public" : "ai",
        payload: {
          summary: `${actor.name} live mock update for ${target.name}`,
          tick,
        },
      }),
    });

    studioStore.applyEnvelope({
      type: "agent.state",
      payload: {
        agentId: actor.id,
        mode: actor.mode === "paused" ? "paused" : tick % 4 === 0 ? "planning" : "acting",
        currentTask: `Live mock tick ${tick}: ${actor.role} update`,
        health: {
          ...actor.health,
          health: Math.max(5, 20 - (tick % 12)),
        },
        updatedAt: new Date().toISOString(),
      },
    });
  }, 4_000);

  return () => {
    window.clearInterval(timer);
    if (window.fetch === mockFetch) {
      window.fetch = originalFetch;
    }
  };
}
