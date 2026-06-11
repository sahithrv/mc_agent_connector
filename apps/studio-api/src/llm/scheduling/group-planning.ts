import type { AgentConfig, EventSeverity } from "@mc-ai-video/contracts";

import type { LlmPlanningTask, LlmWakeReasonType } from "./types";
import type { LlmWakeRouting } from "./wake-rules";

export interface GroupPlanningOptions {
  enabled: boolean;
  minGroupSize?: number;
  maxGroupSize?: number;
  leaderRoles?: string[];
  groupableReasons?: LlmWakeReasonType[];
}

export interface CreatePlanningTasksInput {
  agents: AgentConfig[];
  routing: LlmWakeRouting;
  now: number;
  providerForAgent?: (agent: AgentConfig) => string;
  idFactory?: () => string;
  options?: GroupPlanningOptions;
}

const DEFAULT_GROUPABLE: LlmWakeReasonType[] = [
  "leader_command",
  "found_diamonds",
  "attacked",
  "betrayal",
];

export function createPlanningTasksFromWake(input: CreatePlanningTasksInput): LlmPlanningTask[] {
  if (!input.routing.reason || input.routing.wakeAgentIds.length === 0) return [];

  const options = input.options ?? { enabled: false };
  const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
  const candidates = input.routing.wakeAgentIds
    .map((agentId) => byId.get(agentId))
    .filter((agent): agent is AgentConfig => Boolean(agent));

  if (!shouldGroup(candidates.length, input.routing.reason.type, options)) {
    return candidates.map((agent) => individualTask(agent, input));
  }

  const tasks: LlmPlanningTask[] = [];
  const maxGroupSize = options.maxGroupSize ?? candidates.length;
  for (const group of groupedByTeam(candidates)) {
    for (let index = 0; index < group.length; index += maxGroupSize) {
      const chunk = group.slice(index, index + maxGroupSize);
      const planner = choosePlanner(
        chunk,
        input.agents,
        input.routing.reason.event?.actorId,
        options.leaderRoles ?? ["leader", "commander", "guard"],
      );
      tasks.push({
        id: input.idFactory?.() ?? `${input.routing.reason.type}:${planner.id}:${index}`,
        provider: input.providerForAgent?.(planner) ?? planner.providerRef,
        plannerAgentId: planner.id,
        agentIds: chunk.map((agent) => agent.id).sort(),
        reason: input.routing.reason,
        severity: (input.routing.reason.event?.severity ?? 2) as EventSeverity,
        enqueuedAt: input.now,
        group: { team: planner.team, role: planner.role },
      });
    }
  }

  return tasks;
}

function shouldGroup(
  candidateCount: number,
  reason: LlmWakeReasonType,
  options: GroupPlanningOptions,
): boolean {
  const minGroupSize = options.minGroupSize ?? 2;
  const groupable = options.groupableReasons ?? DEFAULT_GROUPABLE;
  return options.enabled && candidateCount >= minGroupSize && groupable.includes(reason);
}

function individualTask(agent: AgentConfig, input: CreatePlanningTasksInput): LlmPlanningTask {
  const reason = input.routing.reason;
  if (!reason) throw new Error("cannot create planning task without wake reason");
  return {
    id: input.idFactory?.() ?? `${reason.type}:${agent.id}`,
    provider: input.providerForAgent?.(agent) ?? agent.providerRef,
    plannerAgentId: agent.id,
    agentIds: [agent.id],
    reason,
    severity: (reason.event?.severity ?? 2) as EventSeverity,
    enqueuedAt: input.now,
  };
}

function groupedByTeam(agents: AgentConfig[]): AgentConfig[][] {
  const groups = new Map<string, AgentConfig[]>();
  for (const agent of agents) {
    const key = agent.team ?? `agent:${agent.id}`;
    groups.set(key, [...(groups.get(key) ?? []), agent]);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function choosePlanner(
  agents: AgentConfig[],
  allAgents: AgentConfig[],
  actorId: string | undefined,
  leaderRoles: string[],
): AgentConfig {
  const team = agents[0]?.team;
  const actor = allAgents.find((agent) => agent.id === actorId);
  if (actor && (!team || actor.team === team) && leaderRoles.includes(actor.role)) return actor;

  for (const role of leaderRoles) {
    const found = agents.find((agent) => agent.role === role);
    if (found) return found;
  }
  return agents[0] as AgentConfig;
}
