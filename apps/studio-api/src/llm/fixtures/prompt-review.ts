import type { AiChatMessage, GameEvent } from "@mc-ai-video/contracts";

import type { MemoryContext, PromptPerceptionSnapshot, RelationshipContext } from "../prompts";
import type { AgentDecision } from "../schemas/agent-decision";
import type { AiChatMessageProposal } from "../schemas/chat";
import type { ReflectionResult } from "../schemas/reflection-result";

export const samplePerceptionContext: PromptPerceptionSnapshot = {
  agentId: "farmer-1",
  timestamp: "2026-06-10T21:00:00.000Z",
  health: 12,
  food: 17,
  position: { x: 128, y: 64, z: -42, world: "overworld" },
  inventory: [
    { name: "wheat_seeds", count: 16 },
    { name: "bread", count: 2 },
  ],
  nearbyPlayers: [
    {
      id: "leader-1",
      username: "LeaderBot",
      distance: 3,
      threatening: true,
    },
    {
      id: "guard-1",
      username: "GuardBot",
      distance: 9,
    },
  ],
  nearbyMobs: [],
  nearbyItems: [],
  recentEvents: [],
};

export const sampleRelationshipContext: RelationshipContext[] = [
  {
    agentId: "leader-1",
    name: "LeaderBot",
    trust: 38,
    loyalty: 72,
    fear: 22,
    tags: ["leader", "recently_aggressive"],
  },
  {
    agentId: "guard-1",
    name: "GuardBot",
    trust: 66,
    loyalty: 58,
    fear: 8,
    tags: ["ally"],
  },
];

export const sampleMemoryContext: MemoryContext[] = [
  {
    id: "mem-promise-1",
    summary: "Leader promised farmers would be protected during the harvest.",
    importance: 8,
    timestamp: "2026-06-10T20:40:00.000Z",
    relatedAgentIds: ["leader-1", "farmer-1"],
  },
  {
    id: "mem-warning-1",
    summary: "Guard asked farmers to report hostile behavior immediately.",
    importance: 6,
    timestamp: "2026-06-10T20:45:00.000Z",
    relatedAgentIds: ["guard-1"],
  },
];

export const sampleChatContext: AiChatMessage[] = [
  {
    id: "chat-1",
    senderId: "leader-1",
    recipientIds: ["farmer-1", "guard-1"],
    visibility: "ai",
    content: "Keep harvesting. I will handle security.",
    topic: "orders",
    urgency: 2,
    timestamp: "2026-06-10T20:50:00.000Z",
  },
  {
    id: "chat-2",
    senderId: "guard-1",
    recipientIds: ["farmer-1"],
    visibility: "ai",
    content: "Ping me if anyone swings at you.",
    topic: "safety",
    urgency: 3,
    timestamp: "2026-06-10T20:55:00.000Z",
  },
];

export const sampleLeaderAttackEvent: GameEvent = {
  id: "event-leader-attack-1",
  type: "attacked",
  actorId: "leader-1",
  targetId: "farmer-1",
  severity: 5,
  visibility: "ai",
  payload: {
    damage: 4,
    witnessAgentIds: ["guard-1"],
  },
  timestamp: "2026-06-10T21:00:00.000Z",
};

export const expectedWarningDecisionOutput: AgentDecision = {
  intent: "warn_allies",
  action: "chat_ai_private",
  parameters: {
    recipientIds: ["guard-1"],
    message: "Leader hit me near the farm. Stay alert and do not leave me alone with them.",
    topic: "leader_attack_warning",
  },
  speech: {
    visibility: "ai",
    recipientIds: ["guard-1"],
    topic: "leader_attack_warning",
    content: "Leader hit me near the farm. Stay alert and do not leave me alone with them.",
  },
  confidence: 0.86,
  reasoningSummary: "Farmer should warn nearby allies after being attacked by the leader.",
};

export const expectedLeaderAttackReflectionOutput: ReflectionResult = {
  emotionalState: "alarmed",
  relationships: [
    {
      targetId: "leader-1",
      trust: 18,
      loyalty: 24,
      fear: 66,
      tags: ["leader", "attacked_me"],
    },
  ],
  newGoals: [
    "Warn guard-1 about leader-1's attack.",
    "Avoid being isolated with leader-1.",
  ],
  memorySummary: "Leader-1 attacked farmer-1 during the harvest, breaking the protection promise.",
  reasoningSummary: "A direct attack from the leader should sharply reduce loyalty and increase fear.",
};

export const expectedPrivateWarningChatOutput: AiChatMessageProposal = {
  senderId: "farmer-1",
  recipientIds: ["guard-1"],
  visibility: "ai",
  content: "Leader hit me near the farm. Stay alert and do not leave me alone with them.",
  topic: "leader_attack_warning",
  urgency: 5,
};
