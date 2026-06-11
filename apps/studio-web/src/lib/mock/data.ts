import type {
  ActionRequest,
  ActionResult,
  AgentMode,
  AiChatMessage,
  EventSeverity,
  GameEvent,
  JsonValue,
  Visibility,
} from "@mc-ai-video/contracts";

import type { UiAgentDiagnostics, UiTeamRoster } from "../agents/types";
import type { StudioState } from "../state/store";
import { createInitialStudioState } from "../state/store";
import type { UiAgentRuntime } from "../types";
import type { LlmQueueSnapshot } from "../../components/debug/types";
import type { ScenarioConfigView } from "../../components/scenario/types";

const BASE_TIME = Date.parse("2026-06-10T18:00:00.000Z");
const MODES: AgentMode[] = ["routine", "planning", "acting", "paused", "failed"];
const ROLES = ["leader", "miner", "farmer", "guard", "scout", "builder", "trader", "prankster"];
const TEAMS = ["emerald", "redstone", "quartz", "obsidian"];
const PROVIDERS = ["local-llama", "openai-fast", "anthropic-haiku", "gemini-flash"];
const ACTIONS = ["idle", "move_to", "follow", "mine_block", "place_block", "chat_public", "chat_ai_private"];
const EVENT_TYPES = [
  "agent.task.updated",
  "scheduler.planning.started",
  "scheduler.planning.finished",
  "minecraft.chat.public",
  "minecraft.damage",
  "world.block_break",
  "director.trigger",
  "relationship.changed",
  "memory.created",
  "clip.candidate",
];

export interface MockStudioData {
  agents: UiAgentRuntime[];
  events: GameEvent[];
  chat: AiChatMessage[];
  diagnosticsByAgentId: Record<string, UiAgentDiagnostics>;
  teamRoster: UiTeamRoster;
  scenario: ScenarioConfigView;
  llmQueue: LlmQueueSnapshot;
  actionRequests: ActionRequest[];
  actionResults: ActionResult[];
}

export const mockStudioData: MockStudioData = createMockStudioData();

export function createMockStudioData(): MockStudioData {
  const agents = createMockAgents();
  const events = createMockEvents(agents);

  return {
    agents,
    events,
    chat: createMockChat(agents),
    diagnosticsByAgentId: createMockDiagnostics(agents),
    teamRoster: createMockTeamRoster(),
    scenario: createMockScenario(agents),
    llmQueue: createMockLlmQueue(agents),
    actionRequests: createMockActionRequests(agents),
    actionResults: createMockActionResults(agents),
  };
}

export function createMockStudioState(data: MockStudioData = mockStudioData): StudioState {
  return {
    ...createInitialStudioState(),
    session: {
      id: "mock-v1-rehearsal",
      name: "V1 Mock Rehearsal",
      startedAt: isoAt(0),
      status: "running",
    },
    agents: data.agents,
    events: data.events,
    chat: data.chat,
    connection: {
      phase: "connected",
      attempts: 0,
      lastConnectedAt: isoAt(-20),
    },
    health: {
      backend: {
        status: "online",
        message: "Mock Studio API active",
        lastCheckedAt: isoAt(-15),
      },
      minecraft: {
        status: "online",
        message: "Mock offline server stream",
      },
      bots: {
        connected: data.agents.filter((agent) => agent.mode !== "failed").length,
        total: data.agents.length,
        message: "20 mock bots seeded",
      },
      llmQueue: {
        status: "degraded",
        active: data.llmQueue.activeAgentIds?.length ?? 0,
        queued: data.llmQueue.queuedAgentIds?.length ?? 0,
        message: "Mock queue includes active and waiting planners",
      },
    },
    api: {
      loading: false,
      lastCheckedAt: isoAt(-15),
    },
  };
}

function createMockAgents(): UiAgentRuntime[] {
  return Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const id = `agent-${String(number).padStart(2, "0")}`;
    const mode = MODES[index % MODES.length];
    const role = ROLES[index % ROLES.length];
    const team = TEAMS[index % TEAMS.length];
    const providerRef = PROVIDERS[index % PROVIDERS.length];
    const lowHealth = index % 9 === 0;

    return {
      id,
      name: `${titleCase(role)} ${String(number).padStart(2, "0")}`,
      account: {
        username: `bot_${String(number).padStart(2, "0")}`,
        auth: "offline",
      },
      role,
      team,
      mode,
      routine: `${role} patrol`,
      allowedActions: ACTIONS,
      providerRef,
      visibility: "ai",
      currentTask: taskForRole(role, number),
      health: {
        health: lowHealth ? 6 : 20 - (index % 7),
        food: 18 - (index % 5),
        planningQueued: mode === "routine" && index % 4 === 0,
      },
      updatedAt: isoAt(-number * 25),
    };
  });
}

function createMockEvents(agents: UiAgentRuntime[]): GameEvent[] {
  return Array.from({ length: 100 }, (_, index) => {
    const actor = agents[index % agents.length];
    const target = agents[(index * 7 + 3) % agents.length];
    const type = EVENT_TYPES[index % EVENT_TYPES.length];
    const severity = ((index % 5) + 1) as EventSeverity;
    const visibility: Visibility = type.includes("chat.public") ? "public" : index % 4 === 0 ? "recorder" : "ai";
    const error = type === "scheduler.planning.finished" && index % 20 === 2;

    return {
      id: `evt-${String(index + 1).padStart(3, "0")}`,
      type,
      actorId: actor.id,
      targetId: target.id,
      location: {
        x: 180 + (index % 13) * 3,
        y: 64 + (index % 5),
        z: -42 - (index % 17) * 2,
        world: index % 2 === 0 ? "overworld" : "nether-gate",
      },
      severity,
      visibility,
      payload: {
        summary: eventSummary(type, actor.name, target.name),
        providerRef: actor.providerRef,
        objective: actor.currentTask ?? actor.role,
        error: error ? "provider timeout after 12s" : "",
      },
      timestamp: isoAt(-index * 35),
    };
  });
}

function createMockChat(agents: UiAgentRuntime[]): AiChatMessage[] {
  const privateTopics = ["diamond routing", "leader trust", "raid timing", "food cache", "clip warning"];
  const privateMessages = Array.from({ length: 18 }, (_, index) => {
    const sender = agents[index % agents.length];
    const recipient = agents[(index + 4) % agents.length];
    return {
      id: `chat-ai-${String(index + 1).padStart(2, "0")}`,
      senderId: sender.id,
      recipientIds: [recipient.id, "director"],
      topic: privateTopics[index % privateTopics.length],
      urgency: ((index % 5) + 1) as EventSeverity,
      visibility: index % 6 === 0 ? "human-team" : "ai",
      content: `${sender.name} reports ${recipient.name} should adjust ${privateTopics[index % privateTopics.length]}.`,
      timestamp: isoAt(-index * 70 - 10),
    } satisfies AiChatMessage;
  });

  const publicMessages = Array.from({ length: 8 }, (_, index) => {
    const sender = agents[(index * 3) % agents.length];
    return {
      id: `chat-public-${String(index + 1).padStart(2, "0")}`,
      senderId: sender.id,
      recipientIds: ["public"],
      topic: "public mirror",
      urgency: 2 as EventSeverity,
      visibility: "public",
      content: `${sender.account.username}: perimeter clear near watch post ${index + 1}.`,
      timestamp: isoAt(-index * 110 - 45),
    } satisfies AiChatMessage;
  });

  return [...privateMessages, ...publicMessages].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

function createMockDiagnostics(agents: UiAgentRuntime[]): Record<string, UiAgentDiagnostics> {
  return Object.fromEntries(
    agents.map((agent, index) => [
      agent.id,
      {
        relationships: agents
          .filter((candidate) => candidate.id !== agent.id)
          .map((target, targetIndex) => ({
            agentId: agent.id,
            targetAgentId: target.id,
            trust: clamp(42 + ((index + targetIndex) % 9) * 6 - (target.mode === "failed" ? 18 : 0)),
            loyalty: clamp(58 + ((targetIndex * 3) % 8) * 5 - (target.role === "prankster" ? 12 : 0)),
            fear: clamp(8 + ((index * targetIndex) % 7) * 8 + (target.role === "leader" ? 18 : 0)),
            tags: [target.team ?? "unassigned", target.role],
            updatedAt: isoAt(-targetIndex * 90),
          })),
        memories: Array.from({ length: 4 }, (_, memoryIndex) => ({
          id: `${agent.id}-mem-${memoryIndex + 1}`,
          agentId: agent.id,
          kind: ["combat", "resource", "social", "director"][memoryIndex % 4],
          summary:
            memoryIndex === 0
              ? `${agent.name} connected a recent warning to team ${agent.team ?? "unassigned"} and adjusted trust scores after the leader attack sequence.`
              : `${agent.name} remembered ${EVENT_TYPES[(index + memoryIndex) % EVENT_TYPES.length]} near the west gate.`,
          eventId: `evt-${String(((index + memoryIndex) % 100) + 1).padStart(3, "0")}`,
          importance: (((memoryIndex + index) % 5) + 1) as EventSeverity,
          createdAt: isoAt(-memoryIndex * 600 - index * 40),
        })),
        lastDecision: {
          action: agent.mode === "paused" ? "idle" : agent.mode === "acting" ? "move_to" : "reflect",
          note: `${agent.name} is balancing ${agent.role} routine with scenario pressure.`,
          reason: agent.mode === "planning" ? "High-severity event nearby" : "Routine tick",
          confidence: 0.64 + (index % 5) * 0.06,
          createdAt: isoAt(-index * 55),
        },
      },
    ]),
  );
}

function createMockTeamRoster(): UiTeamRoster {
  return {
    aiTeamName: "Studio AI",
    humanTeams: [
      {
        id: "blue-humans",
        name: "Blue Humans",
        members: [
          { id: "human-mira", name: "Mira", kind: "human", teamId: "blue-humans", role: "shot caller", status: "online" },
          { id: "human-jo", name: "Jo", kind: "human", teamId: "blue-humans", role: "runner", status: "online" },
        ],
      },
      {
        id: "gold-humans",
        name: "Gold Humans",
        members: [{ id: "human-ren", name: "Ren", kind: "human", teamId: "gold-humans", role: "saboteur", status: "offline" }],
      },
    ],
    recorders: [
      { id: "rec-main", name: "Recorder One", kind: "recorder", role: "main camera", status: "online" },
      { id: "rec-overhead", name: "Overhead Cam", kind: "recorder", role: "map view", status: "online" },
    ],
    unaffiliated: [{ id: "guest-spectator", name: "Spectator", kind: "unaffiliated", status: "unknown" }],
  };
}

function createMockScenario(agents: UiAgentRuntime[]): ScenarioConfigView {
  return {
    id: "v1-traitor-village",
    name: "Traitor Village Rehearsal",
    teams: TEAMS.map((team) => ({
      id: team,
      name: `${titleCase(team)} Team`,
      agentIds: agents.filter((agent) => agent.team === team).map((agent) => agent.id),
    })),
    roles: agents.map((agent, index) => ({
      agentId: agent.id,
      role: agent.role,
      team: agent.team,
      routine: agent.routine,
      leader: index === 0,
    })),
    startingGoals: agents.slice(0, 8).map((agent, index) => ({
      agentId: agent.id,
      goal: taskForRole(agent.role, index + 1),
      priority: index + 1,
    })),
    secretRoles: [
      { agentId: "agent-08", role: "traitor", visibleTo: ["director", "rec-main"] },
      { agentId: "agent-16", role: "informant", visibleTo: ["director"] },
    ],
    directorTriggers: [
      { id: "diamonds", event: "world.block_break", action: "wake nearby miners", severity: 4 },
      { id: "betrayal", event: "minecraft.damage", action: "force loyalty reflection", severity: 5 },
      { id: "public-warning", event: "minecraft.chat.public", action: "mark clip candidate", severity: 3 },
    ],
  };
}

function createMockLlmQueue(agents: UiAgentRuntime[]): LlmQueueSnapshot {
  return {
    activeAgentIds: agents.filter((agent) => agent.mode === "planning").slice(0, 4).map((agent) => agent.id),
    queuedAgentIds: agents.filter((agent) => agent.health?.planningQueued === true).slice(0, 5).map((agent) => agent.id),
    providerErrors: [
      {
        id: "provider-error-1",
        agentId: "agent-03",
        providerRef: "openai-fast",
        message: "rate limit retry scheduled",
        timestamp: isoAt(-260),
      },
      {
        id: "provider-error-2",
        agentId: "agent-12",
        providerRef: "local-llama",
        message: "context window trim applied",
        timestamp: isoAt(-540),
      },
    ],
    rateLimits: [
      { providerRef: "openai-fast", limited: true, remaining: 2, limit: 10, message: "retry window 18s" },
      { providerRef: "local-llama", limited: false, remaining: 6, limit: 6, message: "local queue clear" },
    ],
    maxConcurrency: 6,
  };
}

function createMockActionRequests(agents: UiAgentRuntime[]): ActionRequest[] {
  return agents.slice(0, 12).map((agent, index) => ({
    id: `act-req-${String(index + 1).padStart(2, "0")}`,
    agentId: agent.id,
    action: ACTIONS[(index + 2) % ACTIONS.length],
    params: { target: agent.currentTask ?? agent.role, index },
    requestedBy: index % 3 === 0 ? "director" : "planner",
    timeoutMs: 12_000,
    createdAt: isoAt(-index * 80 - 30),
  }));
}

function createMockActionResults(agents: UiAgentRuntime[]): ActionResult[] {
  return agents.slice(0, 12).map((agent, index) => {
    const ok = index % 5 !== 2;
    return {
      requestId: `act-req-${String(index + 1).padStart(2, "0")}`,
      agentId: agent.id,
      action: ACTIONS[(index + 2) % ACTIONS.length],
      ok,
      startedAt: isoAt(-index * 80 - 24),
      completedAt: isoAt(-index * 80 - 18 + index),
      error: ok ? undefined : "path blocked by lava",
      data: ok ? { distance: 12 + index } : undefined,
    };
  });
}

export function isoAt(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

export function makeMockEvent(input: {
  id: string;
  type: string;
  actorId?: string;
  targetId?: string;
  severity?: EventSeverity;
  visibility?: Visibility;
  payload?: Record<string, JsonValue>;
}): GameEvent {
  return {
    id: input.id,
    type: input.type,
    actorId: input.actorId,
    targetId: input.targetId,
    location: { x: 214, y: 65, z: -88, world: "overworld" },
    severity: input.severity ?? 3,
    visibility: input.visibility ?? "ai",
    payload: input.payload ?? { summary: "Mock director event" },
    timestamp: new Date().toISOString(),
  };
}

function taskForRole(role: string, number: number): string {
  const tasks: Record<string, string> = {
    leader: "Keep the village alliance intact",
    miner: "Extract diamonds without exposing the tunnel",
    farmer: "Move food to the north cache",
    guard: "Hold the west wall and report attacks",
    scout: "Track human movement near spawn",
    builder: "Repair bridge supports",
    trader: "Negotiate emerald supply routes",
    prankster: "Distract guards without triggering combat",
  };
  return `${tasks[role] ?? "Maintain routine"} #${number}`;
}

function eventSummary(type: string, actor: string, target: string): string {
  if (type === "minecraft.damage") return `${actor} damaged ${target} during the loyalty check.`;
  if (type === "world.block_break") return `${actor} broke a protected block near the diamond branch.`;
  if (type === "minecraft.chat.public") return `${actor} sent a public chat update.`;
  return `${actor} emitted ${type} involving ${target}.`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
