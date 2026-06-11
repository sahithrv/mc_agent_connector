import type { AgentConfig } from "@mc-ai-video/contracts";

import type { ScenarioConfig, ScenarioRole, ScenarioSecretRole } from "../../scenario/types";

export interface ScenarioHumanParticipant {
  id: string;
  username: string;
  teamId?: string;
  isRecorder?: boolean;
}

export interface ScenarioPromptInput {
  scenario: ScenarioConfig;
  viewerAgentId: string;
  viewerRole?: "agent" | "director";
  agents?: AgentConfig[];
  humans?: ScenarioHumanParticipant[];
  premise?: string;
  currentEpisodeGoal?: string;
  directorConstraints?: string[];
}

export interface ScenarioPromptContext {
  scenarioId: string;
  scenarioName?: string;
  premise?: string;
  currentEpisodeGoal?: string;
  directorConstraints: string[];
  self?: {
    agentId: string;
    role?: string;
    teamId?: string;
    leader: boolean;
    routine?: string;
  };
  teams: Array<{
    id: string;
    name?: string;
    agentIds: string[];
    alliedHumanUsernames: string[];
  }>;
  visibleSecretRoles: ScenarioSecretRole[];
  alliedHumanUsernames: string[];
  unaffiliatedHumanUsernames: string[];
  recorderUsernames: string[];
}

export function buildScenarioPromptContext(input: ScenarioPromptInput): ScenarioPromptContext {
  const selfRole = input.scenario.roles.find((role) => role.agentId === input.viewerAgentId);
  const selfTeam = selfRole?.team ?? teamForAgent(input.scenario, input.viewerAgentId);
  const humans = input.humans ?? [];
  const recorders = humans.filter((human) => human.isRecorder === true);
  const socialHumans = humans.filter((human) => human.isRecorder !== true);
  const alliedHumans = selfTeam
    ? socialHumans.filter((human) => human.teamId === selfTeam)
    : [];

  return {
    scenarioId: input.scenario.id,
    scenarioName: input.scenario.name,
    premise: input.premise,
    currentEpisodeGoal: input.currentEpisodeGoal,
    directorConstraints: input.directorConstraints ?? [],
    self: selfRole
      ? {
        agentId: selfRole.agentId,
        role: selfRole.role,
        teamId: selfTeam,
        leader: selfRole.leader === true,
        routine: selfRole.routine,
      }
      : undefined,
    teams: input.scenario.teams.map((team) => ({
      id: team.id,
      name: team.name,
      agentIds: team.agentIds,
      alliedHumanUsernames: socialHumans
        .filter((human) => human.teamId === team.id)
        .map((human) => human.username)
        .sort(),
    })),
    visibleSecretRoles: input.scenario.secretRoles.filter((secret) =>
      canSeeSecret(secret, input.viewerAgentId, input.viewerRole ?? "agent"),
    ),
    alliedHumanUsernames: alliedHumans.map((human) => human.username).sort(),
    unaffiliatedHumanUsernames: socialHumans
      .filter((human) => !human.teamId)
      .map((human) => human.username)
      .sort(),
    recorderUsernames: recorders.map((human) => human.username).sort(),
  };
}

export function renderScenarioPromptContext(context: ScenarioPromptContext): string {
  const lines = [
    `Scenario: ${context.scenarioName ?? context.scenarioId}`,
  ];

  pushLine(lines, "Premise", context.premise);
  pushLine(lines, "Episode goal", context.currentEpisodeGoal);
  if (context.self) {
    lines.push(`You are ${context.self.agentId}; role=${context.self.role ?? "unknown"}; team=${context.self.teamId ?? "none"}; leader=${context.self.leader ? "yes" : "no"}.`);
  }
  if (context.teams.length > 0) {
    lines.push(`Teams: ${context.teams.map((team) => `${team.id}(${team.agentIds.join(",")})`).join("; ")}`);
  }
  if (context.alliedHumanUsernames.length > 0) {
    lines.push(`Allied humans: ${context.alliedHumanUsernames.join(", ")}.`);
  }
  if (context.unaffiliatedHumanUsernames.length > 0) {
    lines.push(`Unaffiliated humans are present but not allies: ${context.unaffiliatedHumanUsernames.join(", ")}.`);
  }
  if (context.recorderUsernames.length > 0) {
    lines.push(`Recorders observe only; do not treat them as social participants: ${context.recorderUsernames.join(", ")}.`);
  }
  if (context.visibleSecretRoles.length > 0) {
    lines.push(`Visible secrets: ${context.visibleSecretRoles.map((secret) => `${secret.agentId}=${secret.role}`).join("; ")}.`);
  }
  if (context.directorConstraints.length > 0) {
    lines.push(`Director constraints: ${context.directorConstraints.join("; ")}.`);
  }

  return lines.join("\n");
}

function canSeeSecret(
  secret: ScenarioSecretRole,
  viewerAgentId: string,
  viewerRole: "agent" | "director",
): boolean {
  return viewerRole === "director"
    || secret.agentId === viewerAgentId
    || secret.visibleTo.includes(viewerAgentId)
    || secret.visibleTo.includes("all");
}

function teamForAgent(scenario: ScenarioConfig, agentId: string): string | undefined {
  const explicitRole = scenario.roles.find((role: ScenarioRole) => role.agentId === agentId);
  if (explicitRole?.team) return explicitRole.team;
  return scenario.teams.find((team) => team.agentIds.includes(agentId))?.id;
}

function pushLine(lines: string[], label: string, value: string | undefined): void {
  if (value && value.trim().length > 0) {
    lines.push(`${label}: ${value.trim()}`);
  }
}
