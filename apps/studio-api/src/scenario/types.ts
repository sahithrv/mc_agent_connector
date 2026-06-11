import type { EventSeverity } from "@mc-ai-video/contracts";

export interface ScenarioTeam {
  id: string;
  name?: string;
  agentIds: string[];
}

export interface ScenarioRole {
  agentId: string;
  role: string;
  team?: string;
  routine?: string;
  leader?: boolean;
}

export interface ScenarioStartingGoal {
  agentId: string;
  goal: string;
  priority: number;
}

export interface ScenarioSecretRole {
  agentId: string;
  role: string;
  visibleTo: string[];
}

export interface ScenarioDirectorTrigger {
  id: string;
  event: string;
  action: string;
  severity?: EventSeverity;
}

export interface ScenarioConfig {
  id: string;
  name?: string;
  teams: ScenarioTeam[];
  roles: ScenarioRole[];
  startingGoals: ScenarioStartingGoal[];
  secretRoles: ScenarioSecretRole[];
  directorTriggers: ScenarioDirectorTrigger[];
}
