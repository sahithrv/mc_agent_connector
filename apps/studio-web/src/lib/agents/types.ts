import type { EventSeverity } from "@mc-ai-video/contracts";

export interface UiAgentRelationship {
  agentId: string;
  targetAgentId: string;
  trust?: number;
  loyalty?: number;
  fear?: number;
  tags?: string[];
  updatedAt?: string;
}

export interface UiAgentMemory {
  id: string;
  agentId: string;
  kind: string;
  summary: string;
  eventId?: string;
  importance: EventSeverity;
  createdAt: string;
}

export interface UiAgentDecision {
  action?: string;
  note?: string;
  reason?: string;
  confidence?: number;
  createdAt?: string;
}

export interface UiAgentDiagnostics {
  relationships?: UiAgentRelationship[];
  memories?: UiAgentMemory[];
  lastDecision?: UiAgentDecision;
}

export type RosterMemberKind = "ai" | "human" | "recorder" | "unaffiliated";

export interface UiRosterMember {
  id: string;
  name: string;
  kind: RosterMemberKind;
  teamId?: string;
  role?: string;
  status?: "online" | "offline" | "unknown";
}

export interface UiHumanTeam {
  id: string;
  name: string;
  members: UiRosterMember[];
}

export interface UiTeamRoster {
  aiTeamName?: string;
  humanTeams?: UiHumanTeam[];
  recorders?: UiRosterMember[];
  unaffiliated?: UiRosterMember[];
}
