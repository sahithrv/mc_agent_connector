import type { AgentConfig, Position } from "@mc-ai-video/contracts";

import type { ParticipantOption, StudioChatMessage } from "./types";

export function buildParticipantOptions(
  agents: readonly AgentConfig[],
  messages: readonly StudioChatMessage[],
): ParticipantOption[] {
  const participants = new Map<string, string>();

  participants.set("director", "Director");
  participants.set("ai-team-human", "AI-team human");
  participants.set("recorder", "Recorder");

  for (const agent of agents) {
    const username = agent.account.username ? ` / ${agent.account.username}` : "";
    participants.set(agent.id, `${agent.name}${username}`);
  }

  for (const message of messages) {
    addFallbackParticipant(participants, message.senderId);
    for (const recipientId of message.recipientIds) {
      addFallbackParticipant(participants, recipientId);
    }
  }

  return [...participants.entries()].map(([value, label]) => ({ value, label }));
}

export function participantLabel(
  participantId: string,
  participants: readonly ParticipantOption[],
): string {
  return participants.find((participant) => participant.value === participantId)?.label ?? participantId;
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatLocation(location?: Position | string): string {
  if (!location) {
    return "Location unknown";
  }

  if (typeof location === "string") {
    return location;
  }

  const world = location.world ? `${location.world} ` : "";
  return `${world}${Math.round(location.x)}, ${Math.round(location.y)}, ${Math.round(location.z)}`;
}

export function sortNewestMessages<T extends { timestamp: string; id: string }>(messages: readonly T[]): T[] {
  return [...messages].sort((left, right) => {
    const byTime = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

function addFallbackParticipant(participants: Map<string, string>, id: string): void {
  if (!participants.has(id)) {
    participants.set(id, id);
  }
}
