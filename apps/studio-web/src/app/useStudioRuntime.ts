import { useCallback, useEffect, useRef } from "react";

import { getAgentConfigs } from "../lib/api/agents";
import { getHealthSnapshot } from "../lib/api/health";
import { normalizeApiError } from "../lib/api/client";
import { runtimeApi } from "../lib/api/runtime";
import { shouldUseStudioMocks, startMockStudioRuntime } from "../lib/mock/runtime";
import { createDashboardWsClient } from "../lib/ws/dashboardClient";
import { studioStore } from "../lib/state/store";

export function useStudioRuntime(): { retryHealth: () => Promise<void> } {
  const healthRequestIdRef = useRef(0);

  const retryHealth = useCallback(async () => {
    const requestId = ++healthRequestIdRef.current;
    studioStore.setApiStatus({ loading: true, error: undefined });

    try {
      const [health, agents, runtime] = await Promise.all([
        getHealthSnapshot(),
        getAgentConfigs(),
        runtimeApi.getStatus(),
      ]);
      if (healthRequestIdRef.current === requestId) {
        studioStore.setAgents(agents);
        studioStore.setHealth(health);
        studioStore.setRuntimeStatus(runtime);
        studioStore.setApiStatus({ loading: false, lastCheckedAt: health.backend.lastCheckedAt });
      }
    } catch (error) {
      if (healthRequestIdRef.current === requestId) {
        const apiError = normalizeApiError(error);
        studioStore.setHealth({
          backend: {
            status: "offline",
            message: apiError.message,
            lastCheckedAt: new Date().toISOString(),
          },
          minecraft: { status: "unknown", message: "Minecraft telemetry is not exposed yet" },
          bots: { connected: 0, total: studioStore.getSnapshot().agents.length },
          llmQueue: { status: "unknown", active: 0, queued: 0, message: "Queue endpoint pending" },
        });
        studioStore.setApiStatus({ loading: false, error: apiError });
      }
    }
  }, []);

  useEffect(() => {
    if (shouldUseStudioMocks()) {
      return startMockStudioRuntime();
    }

    studioStore.setSession({
      id: "local-dashboard",
      name: "Local V1 rehearsal",
      startedAt: new Date().toISOString(),
      status: "booting",
    });

    void retryHealth();
    const healthInterval = window.setInterval(() => {
      void retryHealth();
    }, 10_000);

    const ws = createDashboardWsClient({
      onConnectionChange: (connection) => studioStore.setConnection(connection),
      onEnvelope: (envelope) => studioStore.applyEnvelope(envelope),
    });

    ws.connect();

    return () => {
      window.clearInterval(healthInterval);
      ws.disconnect();
    };
  }, [retryHealth]);

  return { retryHealth };
}
