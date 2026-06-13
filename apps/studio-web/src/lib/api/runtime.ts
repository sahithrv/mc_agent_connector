import type {
  RuntimeLaunchRequest,
  RuntimeLaunchResponse,
  RuntimeStatusSnapshot,
} from "@mc-ai-video/contracts";

import { ApiClient } from "./client";

const client = new ApiClient();

export interface RuntimeControlApi {
  getStatus(): Promise<RuntimeStatusSnapshot>;
  launch(input: RuntimeLaunchRequest): Promise<RuntimeLaunchResponse>;
  stopAgent(agentId: string, reason?: string): Promise<RuntimeLaunchResponse>;
  stopAgents(agentIds: string[], reason?: string): Promise<RuntimeLaunchResponse>;
}

export const runtimeApi: RuntimeControlApi = {
  getStatus(api = client) {
    return api.get<RuntimeStatusSnapshot>("/runtime/status");
  },
  launch(input, api = client) {
    return api.request<RuntimeLaunchResponse>("/runtime/launch", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  stopAgent(agentId, reason, api = client) {
    return api.request<RuntimeLaunchResponse>(
      `/runtime/agents/${encodeURIComponent(agentId)}/stop`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  },
  stopAgents(agentIds, reason, api = client) {
    return api.request<RuntimeLaunchResponse>("/runtime/agents/stop-all", {
      method: "POST",
      body: JSON.stringify({ agentIds, reason }),
    });
  },
};
