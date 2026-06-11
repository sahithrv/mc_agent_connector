import type { AgentConfig, GameEvent, JsonValue } from "@mc-ai-video/contracts";

import type { WakeReason, WakeReasonType } from "./types";

const WAKE_TYPES: Record<string, WakeReasonType> = {
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

export function routeWakeEvent(event: GameEvent, agents: AgentConfig[]): Map<string, WakeReason> {
  const wakeType = WAKE_TYPES[event.type];
  const routed = new Map<string, WakeReason>();
  if (!wakeType) {
    return routed;
  }

  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const add = (agentId: string | undefined) => {
    if (agentId && byId.has(agentId)) {
      routed.set(agentId, { type: wakeType, event });
    }
  };

  // Event wakeups stay targeted so severe events do not force every agent to plan.
  if (wakeType === "direct_mention") {
    for (const agentId of stringArray(event.payload.mentionedAgentIds)) add(agentId);
    add(event.targetId);
    return routed;
  }

  if (wakeType === "leader_command") {
    const recipients = stringArray(event.payload.recipientIds);
    if (recipients.length > 0) {
      recipients.forEach(add);
      return routed;
    }
    const leader = byId.get(event.actorId ?? "");
    for (const agent of agents) {
      if (leader?.team && agent.team === leader.team && agent.id !== leader.id) add(agent.id);
    }
    return routed;
  }

  add(event.actorId);
  add(event.targetId);
  for (const agentId of stringArray(event.payload.agentIds)) add(agentId);
  for (const agentId of stringArray(event.payload.witnessAgentIds)) add(agentId);

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

  return routed;
}

export function cancellationTargetsForEvent(event: GameEvent): string[] | "all" {
  if (event.type === "director.pause_all" || event.type === "agent.disconnect_all") {
    return "all";
  }

  if (
    event.type === "director.interrupt" ||
    event.type === "agent.pause" ||
    event.type === "agent.disconnect" ||
    event.type === "attacked" ||
    event.type === "agent.attacked"
  ) {
    const targets = new Set<string>();
    if (event.targetId) targets.add(event.targetId);
    for (const agentId of stringArray(event.payload.agentIds)) targets.add(agentId);
    const agentId = stringValue(event.payload.agentId);
    if (agentId) targets.add(agentId);
    return [...targets];
  }

  return [];
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
