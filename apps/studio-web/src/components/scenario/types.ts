import type { EventSeverity } from "@mc-ai-video/contracts";

export interface ScenarioTeamView {
  id: string;
  name?: string;
  agentIds: string[];
}

export interface ScenarioRoleView {
  agentId: string;
  role: string;
  team?: string;
  routine?: string;
  leader?: boolean;
}

export interface ScenarioStartingGoalView {
  agentId: string;
  goal: string;
  priority: number;
}

export interface ScenarioSecretRoleView {
  agentId: string;
  role: string;
  visibleTo: string[];
}

export interface ScenarioDirectorTriggerView {
  id: string;
  event: string;
  action: string;
  severity?: EventSeverity;
}

// Mirrors the current studio-api scenario contract until scenario config moves into packages/contracts.
export interface ScenarioConfigView {
  id: string;
  name?: string;
  teams: ScenarioTeamView[];
  roles: ScenarioRoleView[];
  startingGoals: ScenarioStartingGoalView[];
  secretRoles: ScenarioSecretRoleView[];
  directorTriggers: ScenarioDirectorTriggerView[];
}
