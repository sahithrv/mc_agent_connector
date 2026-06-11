import { ApiClient } from "./client";
import type { PendingDirectorCommand } from "../types";

export interface AgentControlResponse {
  ok: boolean;
  command: PendingDirectorCommand;
}

export interface AgentControlRequest {
  reason?: string;
  requestedBy?: string;
}

export interface AgentControlApi {
  pauseAgent(agentId: string, request?: AgentControlRequest): Promise<AgentControlResponse>;
  resumeAgent(agentId: string, request?: AgentControlRequest): Promise<AgentControlResponse>;
  pauseAll(request?: AgentControlRequest): Promise<AgentControlResponse>;
  resumeAll(request?: AgentControlRequest): Promise<AgentControlResponse>;
}

const client = new ApiClient();

export const agentControls: AgentControlApi = {
  pauseAgent(agentId, request) {
    return postControl(`/director/agents/${encodeURIComponent(agentId)}/pause`, request);
  },
  resumeAgent(agentId, request) {
    return postControl(`/director/agents/${encodeURIComponent(agentId)}/resume`, request);
  },
  pauseAll(request) {
    return postControl("/director/agents/pause-all", request);
  },
  resumeAll(request) {
    return postControl("/director/agents/resume-all", request);
  },
};

function postControl(path: string, request: AgentControlRequest = {}): Promise<AgentControlResponse> {
  return client.request<AgentControlResponse>(path, {
    method: "POST",
    body: JSON.stringify({
      requestedBy: request.requestedBy ?? "studio-web",
      reason: request.reason,
    }),
  });
}
