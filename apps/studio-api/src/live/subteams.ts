import type { AgentConfig, JsonValue } from "@mc-ai-video/contracts";

export interface SubteamView {
  id: string;
  leaderId?: string;
  leaderUsername?: string;
  memberIds: string[];
}

export interface RecipientRequest {
  recipientIds?: unknown;
  recipientId?: unknown;
  subteam?: unknown;
  subteamId?: unknown;
  team?: unknown;
  leadersOnly?: unknown;
}

export class SubteamDirectory {
  private readonly byAgentId = new Map<string, AgentConfig>();
  private readonly subteams = new Map<string, SubteamView>();

  constructor(agents: AgentConfig[]) {
    for (const agent of agents) {
      this.addAgent(agent);
    }

    for (const team of this.subteams.values()) {
      this.ensureLeader(team);
    }
  }

  addAgent(agent: AgentConfig): boolean {
    if (this.byAgentId.has(agent.id)) {
      return false;
    }
    this.byAgentId.set(agent.id, agent);
    const subteamId = agent.subteam ?? agent.team ?? "ai";
    const team = this.subteams.get(subteamId) ?? {
      id: subteamId,
      memberIds: [],
    };
    team.memberIds.push(agent.id);
    team.memberIds.sort();
    if (agent.leader === true || !team.leaderId) {
      team.leaderId = agent.id;
      team.leaderUsername = agent.account.username;
    }
    this.subteams.set(subteamId, team);
    return true;
  }

  list(): SubteamView[] {
    return [...this.subteams.values()]
      .map((team) => ({ ...team, memberIds: [...team.memberIds] }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  teamForAgent(agentId: string): SubteamView | undefined {
    const agent = this.byAgentId.get(agentId);
    if (!agent) return undefined;
    return this.subteams.get(agent.subteam ?? agent.team ?? "ai");
  }

  teammates(agentId: string, includeSelf = true): string[] {
    const team = this.teamForAgent(agentId);
    if (!team) return [];
    return team.memberIds.filter((id) => includeSelf || id !== agentId);
  }

  leaderForAgent(agentId: string): AgentConfig | undefined {
    const leaderId = this.teamForAgent(agentId)?.leaderId;
    return leaderId ? this.byAgentId.get(leaderId) : undefined;
  }

  leaderUsernameForAgent(agentId: string): string | undefined {
    return this.leaderForAgent(agentId)?.account.username;
  }

  leaderIds(excludeAgentId?: string): string[] {
    return this.list()
      .map((team) => team.leaderId)
      .filter((id): id is string => Boolean(id && id !== excludeAgentId));
  }

  describeForAgent(agentId: string): string {
    const selfTeam = this.teamForAgent(agentId);
    const teams = this.list().map((team) => {
      const leader = team.leaderId
        ? `leader=${team.leaderId}${team.leaderUsername ? `/${team.leaderUsername}` : ""}`
        : "leader=none";
      const self = team.id === selfTeam?.id ? " self-team" : "";
      return `${team.id}(${leader}; members=${team.memberIds.join("|")})${self}`;
    });
    return teams.join("; ");
  }

  resolveRecipients(senderId: string, request: RecipientRequest): string[] {
    const explicit = stringArray(request.recipientIds)
      ?? (stringValue(request.recipientId) ? [stringValue(request.recipientId) as string] : undefined);
    if (explicit?.length) {
      return this.onlyKnown(explicit, senderId);
    }

    const requestedTeam = stringValue(request.subteam)
      ?? stringValue(request.subteamId)
      ?? stringValue(request.team);
    if (requestedTeam) {
      const team = this.subteams.get(requestedTeam);
      return team ? this.onlyKnown(team.memberIds, senderId) : [];
    }

    if (request.leadersOnly === true) {
      return this.leaderIds(senderId);
    }

    return this.teammates(senderId, false);
  }

  private onlyKnown(ids: string[], excludeAgentId?: string): string[] {
    return [...new Set(ids)].filter((id) => id !== excludeAgentId && this.byAgentId.has(id));
  }

  private ensureLeader(team: SubteamView): void {
    team.memberIds.sort();
    if (team.leaderId) return;
    const fallbackLeader = team.memberIds
      .map((id) => this.byAgentId.get(id))
      .find((agent): agent is AgentConfig => Boolean(agent));
    team.leaderId = fallbackLeader?.id;
    team.leaderUsername = fallbackLeader?.account.username;
  }
}

export function jsonRecipientRequest(params: Record<string, unknown>): RecipientRequest {
  return {
    recipientIds: params.recipientIds,
    recipientId: params.recipientId,
    subteam: params.subteam,
    subteamId: params.subteamId,
    team: params.team,
    leadersOnly: params.leadersOnly,
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length === value.length ? strings : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function subteamJson(team: SubteamView): Record<string, JsonValue> {
  return {
    id: team.id,
    leaderId: team.leaderId ?? "",
    leaderUsername: team.leaderUsername ?? "",
    memberIds: team.memberIds,
  };
}
