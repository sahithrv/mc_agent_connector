import type { AgentConfig } from "@mc-ai-video/contracts";

import { ApiClient } from "./client";

const client = new ApiClient();

export interface AgentListResponse {
  agents: AgentConfig[];
}

export interface UpdateAgentResponse {
  ok: boolean;
  agent: AgentConfig;
}

export interface UpdateAgentInput {
  name?: string;
  role?: string;
  team?: string;
  subteam?: string;
  leader?: boolean;
  enabled?: boolean;
  personality?: string;
  routine?: string;
  providerRef?: string;
  behavior?: AgentConfig["behavior"];
  account?: Partial<AgentConfig["account"]>;
}

export async function getAgentConfigs(api = client): Promise<AgentConfig[]> {
  const response = await api.get<AgentListResponse>("/director/agents");
  return response.agents;
}

export async function updateAgentConfig(
  agentId: string,
  input: UpdateAgentInput,
  api = client,
): Promise<AgentConfig> {
  const response = await api.request<UpdateAgentResponse>(
    `/director/agents/${encodeURIComponent(agentId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return response.agent;
}
