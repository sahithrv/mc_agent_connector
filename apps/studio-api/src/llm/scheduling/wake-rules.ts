import type { AgentConfig, GameEvent, JsonValue } from "@mc-ai-video/contracts";

import type { LlmWakeReason, LlmWakeReasonType } from "./types";

const WAKE_TYPES: Record<string, LlmWakeReasonType> = {
  attacked: "attacked",
  "agent.attacked": "attacked",
  death: "death",
  "agent.death": "death",
  found_diamonds: "found_diamonds",
  "miner.found_diamonds": "found_diamonds",
  leader_command: "leader_command",
  "chat.leader_command": "leader_command",
  direct_mention: "direct_mention",
  "chat.direct_mention": "direct_mention",
  betrayal: "betrayal",
  "agent.betrayal": "betrayal",
};

export interface LlmWakeRouting {
  reason?: LlmWakeReason;
  wakeAgentIds: string[];
  routineAgentIds: string[];
}

export function routeLlmWakeEvent(event: GameEvent, agents: AgentConfig[]): LlmWakeRouting {
  const wakeType = WAKE_TYPES[event.type];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const routed = new Set<string>();

  if (!wakeType) {
    return {
      wakeAgentIds: [],
      routineAgentIds: agents.map((agent) => agent.id),
    };
  }

  const add = (agentId: string | undefined) => {
    if (agentId && byId.has(agentId)) routed.add(agentId);
  };

  if (wakeType === "direct_mention") {
    for (const agentId of stringArray(event.payload.mentionedAgentIds)) add(agentId);
    add(event.targetId);
  } else if (wakeType === "leader_command") {
    const recipients = stringArray(event.payload.recipientIds);
    if (recipients.length > 0) {
      recipients.forEach(add);
    } else {
      const leader = byId.get(event.actorId ?? "");
      for (const agent of agents) {
        if (leader?.team && agent.team === leader.team && agent.id !== leader.id) add(agent.id);
      }
    }
  } else {
    add(event.actorId);
    add(event.targetId);
    for (const agentId of stringArray(event.payload.agentIds)) add(agentId);
    for (const agentId of stringArray(event.payload.witnessAgentIds)) add(agentId);
    add(stringValue(event.payload.agentId));

    if (wakeType === "attacked" || wakeType === "betrayal") {
      const target = byId.get(event.targetId ?? "");
      for (const agent of agents) {
        if (target?.team && agent.team === target.team && agent.role === "guard") add(agent.id);
      }
    }

    if (wakeType === "found_diamonds") {
      const actor = byId.get(event.actorId ?? "");
      for (const agent of agents) {
        if (actor?.team && agent.team === actor.team && agent.role === "leader") add(agent.id);
      }
    }
  }

  const wakeAgentIds = [...routed].sort();
  return {
    reason: { type: wakeType, event },
    wakeAgentIds,
    routineAgentIds: agents
      .map((agent) => agent.id)
      .filter((agentId) => !routed.has(agentId))
      .sort(),
  };
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
