import { ApiClient } from "./client";
import type { UiHealthSnapshot } from "../types";

interface BackendHealthResponse {
  ok?: boolean;
}

const client = new ApiClient();

export async function getHealthSnapshot(api = client): Promise<UiHealthSnapshot> {
  const response = await api.get<BackendHealthResponse>("/healthz");
  const checkedAt = new Date().toISOString();

  return {
    backend: {
      status: response.ok ? "online" : "degraded",
      message: response.ok ? "Studio API responding" : "Studio API response was not ok",
      lastCheckedAt: checkedAt,
    },
    minecraft: {
      status: "unknown",
      message: "Minecraft server health contract pending",
    },
    bots: {
      connected: 0,
      total: 0,
      message: "Bot counts will attach to runtime snapshots",
    },
    llmQueue: {
      status: "unknown",
      active: 0,
      queued: 0,
      message: "LLM queue health contract pending",
    },
  };
}
