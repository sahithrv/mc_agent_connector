import type {
  AgentConfig,
  AiChatMessage,
  BotConnectionStatus,
  EventSeverity,
  GameEvent,
  JsonValue,
  RuntimeAgentControlResult,
  RuntimeStatusSnapshot,
  Visibility,
} from "@mc-ai-video/contracts";

import type { AgentControlApi, AgentControlResponse } from "../api/agentControls";
import type {
  DirectorAnnouncementInput,
  DirectorClipInput,
  DirectorClipMarker,
  DirectorEventInput,
  DirectorInjectionInput,
  RoleAssignmentInput,
} from "../api/director";
import type { PendingDirectorCommand, UiAgentRuntime } from "../types";
import { studioStore } from "../state/store";
import { isoAt, makeMockEvent, mockStudioData } from "./data";

interface MockDirectorResponse {
  ok: true;
  agent?: UiAgentRuntime;
  event?: GameEvent;
  message?: AiChatMessage;
  marker?: DirectorClipMarker;
  command: PendingDirectorCommand;
}

export const mockDirectorApi = {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const pathname = apiPath(path);
    const body = await parseBody(init.body);

    if (pathname === "/director/events") {
      const input = body as Partial<DirectorEventInput>;
      const event = makeMockEvent({
        id: `mock-injected-${Date.now()}`,
        type: text(input.type, "director.injected"),
        actorId: optionalText(input.actorId),
        targetId: optionalText(input.targetId),
        severity: severity(input.severity),
        visibility: visibility(input.visibility),
        payload: recordPayload(input.payload),
      });
      return response<T>({ event, command: command("inject-event", { eventId: event.id }) });
    }

    if (pathname === "/director/chat") {
      const input = body as Partial<DirectorAnnouncementInput>;
      const message = createMockChatMessage({
        senderId: text(input.senderId, "director"),
        recipientIds: Array.isArray(input.recipientIds) ? input.recipientIds : ["agent-01"],
        topic: optionalText(input.topic),
        urgency: severity(input.urgency),
        visibility: visibility(input.visibility ?? "ai"),
        content: text(input.content, "Director mock announcement"),
      });
      return response<T>({ message, command: command("send-ai-chat", { messageId: message.id }) });
    }

    if (pathname === "/director/clips") {
      const input = body as Partial<DirectorClipInput>;
      const marker: DirectorClipMarker = {
        id: `mock-clip-${Date.now()}`,
        title: text(input.title, "Director marker"),
        notes: optionalText(input.notes),
        sourceEventId: optionalText(input.eventId),
        timestamp: optionalText(input.timestamp) ?? new Date().toISOString(),
        kind: "manual",
      };
      return response<T>({ marker, command: command("mark-clip", { markerId: marker.id }) });
    }

    if (pathname === "/director/injections") {
      const input = body as Partial<DirectorInjectionInput>;
      const type = input.kind === "god-dialogue"
        ? "god-dialogue"
        : input.kind === "role" && input.scope === "agent"
          ? "set-agent-role"
          : input.kind === "task" && input.scope === "agent"
            ? "set-agent-task"
            : (input.kind === "task" || input.kind === "team-task") && input.scope === "subteam"
              ? "set-subteam-task"
              : "inject-agent-context";
      return response<T>({
        command: command(type, {
          kind: text(input.kind, "instruction"),
          scope: text(input.scope, "all"),
          text: text(input.text, "Mock injection"),
          role: input.kind === "role" ? text(input.text, "Role") : "",
          task: input.kind === "task" || input.kind === "team-task" ? text(input.text, "Task") : "",
          agentId: optionalText(input.agentId) ?? "",
          subteamId: optionalText(input.subteamId) ?? "",
        }, optionalText(input.agentId)),
      });
    }

    if (pathname === "/director/agents") {
      if ((init.method ?? "GET").toUpperCase() === "GET") {
        return { agents: studioStore.getSnapshot().agents } as T;
      }

      const input = body as {
        id?: string;
        name?: string;
        role?: string;
        team?: string;
        subteam?: string;
        leader?: boolean;
        account?: { username?: string };
        providerRef?: string;
      };
      const agent: UiAgentRuntime = {
        id: text(input.id, `agent-${Date.now()}`),
        name: text(input.name, "New Agent"),
        account: { username: text(input.account?.username, "NewAgent") },
        role: text(input.role, "Scout"),
        team: optionalText(input.team) ?? "ai",
        subteam: optionalText(input.subteam),
        leader: input.leader === true,
        mode: "routine",
        allowedActions: ["idle", "continue_routine", "chat_ai_private"],
        providerRef: optionalText(input.providerRef) ?? "deepseek",
      };
      const snapshot = studioStore.getSnapshot();
      studioStore.reset({ ...snapshot, agents: [...snapshot.agents, agent] });
      return response<T>({
        agent,
        command: command("add-agent", { agent: agent as unknown as Record<string, JsonValue> }, agent.id),
      });
    }

    const updateMatch = /^\/director\/agents\/([^/]+)$/.exec(pathname);
    if (updateMatch && (init.method ?? "GET").toUpperCase() === "PATCH") {
      const agentId = decodeURIComponent(updateMatch[1]);
      const input = body as Partial<AgentConfig>;
      const snapshot = studioStore.getSnapshot();
      const agents = snapshot.agents.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              ...input,
              account: {
                ...agent.account,
                ...(input.account ?? {}),
              },
              mode: agent.mode,
              updatedAt: new Date().toISOString(),
            }
          : agent,
      );
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        throw new Error(`unknown agent: ${agentId}`);
      }
      studioStore.reset({ ...snapshot, agents });
      return response<T>({
        agent,
        command: command("update-agent", { agent: agent as unknown as Record<string, JsonValue> }, agent.id),
      });
    }

    if (pathname === "/runtime/status") {
      return runtimeStatusFromStore() as T;
    }

    if (pathname === "/runtime/launch") {
      const input = body as { agentIds?: string[]; scenarioGoal?: string };
      const ids = Array.isArray(input.agentIds) ? input.agentIds : [];
      setAgentRuntimeStatus(new Set(ids), "connected");
      return {
        ok: true,
        results: ids.map((agentId) => runtimeResult(agentId, "connected", true)),
      } as T;
    }

    const stopMatch = /^\/runtime\/agents\/([^/]+)\/stop$/.exec(pathname);
    if (stopMatch) {
      const agentId = decodeURIComponent(stopMatch[1]);
      setAgentRuntimeStatus(new Set([agentId]), "disconnected");
      return {
        ok: true,
        results: [runtimeResult(agentId, "disconnected", true)],
      } as T;
    }

    if (pathname === "/runtime/agents/stop-all") {
      const input = body as { agentIds?: string[] };
      const snapshot = studioStore.getSnapshot();
      const ids = Array.isArray(input.agentIds) ? input.agentIds : snapshot.agents.map((agent) => agent.id);
      setAgentRuntimeStatus(new Set(ids), "disconnected");
      return {
        ok: true,
        results: ids.map((agentId) => runtimeResult(agentId, "disconnected", true)),
      } as T;
    }

    if (pathname === "/chat/messages") {
      return { messages: mockStudioData.chat } as T;
    }

    if (pathname === "/healthz") {
      return { ok: true } as T;
    }

    throw new Error(`Mock API has no handler for ${pathname}`);
  },
  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  },
};

export const mockAgentControls: AgentControlApi = {
  async pauseAgent(agentId, request) {
    setAgentModes(new Set([agentId]), "paused");
    return controlResponse("pause-agent", agentId, request?.reason);
  },
  async resumeAgent(agentId, request) {
    setAgentModes(new Set([agentId]), "routine");
    return controlResponse("resume-agent", agentId, request?.reason);
  },
  async pauseAll(request) {
    setAgentModes(undefined, "paused");
    return controlResponse("pause-all", undefined, request?.reason);
  },
  async resumeAll(request) {
    setAgentModes(undefined, "routine");
    return controlResponse("resume-all", undefined, request?.reason);
  },
};

export async function mockSendDirectorChat(input: {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility?: Visibility;
  content?: string;
}): Promise<AiChatMessage> {
  return createMockChatMessage({
    senderId: input.senderId,
    recipientIds: input.recipientIds,
    topic: input.topic,
    urgency: input.urgency ?? 3,
    visibility: input.visibility ?? "ai",
    content: input.content ?? "Director mock message",
  });
}

export async function mockAssignRole(assignment: RoleAssignmentInput): Promise<void> {
  const snapshot = studioStore.getSnapshot();
  const agents = snapshot.agents.map((agent) =>
    agent.id === assignment.agentId
      ? {
          ...agent,
          role: assignment.secret ? `${assignment.role} (secret)` : assignment.role,
          updatedAt: new Date().toISOString(),
        }
      : agent,
  );

  studioStore.reset({
    ...snapshot,
    agents,
  });
}

export function createMockFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const pathname = apiPath(input instanceof Request ? input.url : input.toString());
    if (!isMockablePath(pathname)) {
      return originalFetch(input, init);
    }

    try {
      const body = await mockDirectorApi.request<unknown>(pathname, init);
      return jsonResponse(body, 200);
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : "Mock API request failed",
        },
        404,
      );
    }
  };
}

function setAgentModes(agentIds: Set<string> | undefined, mode: UiAgentRuntime["mode"]): void {
  const snapshot = studioStore.getSnapshot();
  const now = new Date().toISOString();
  const agents = snapshot.agents.map((agent) =>
    !agentIds || agentIds.has(agent.id)
      ? {
          ...agent,
          mode,
          currentTask: mode === "paused" ? "Paused by director interlock" : agent.currentTask,
          updatedAt: now,
        }
      : agent,
  );

  studioStore.reset({
    ...snapshot,
    agents,
    health: {
      ...snapshot.health,
      bots: {
        ...snapshot.health.bots,
        connected: agents.filter((agent) => agent.mode !== "failed").length,
        total: agents.length,
      },
    },
  });
}

function setAgentRuntimeStatus(agentIds: Set<string>, connectionStatus: BotConnectionStatus): void {
  const snapshot = studioStore.getSnapshot();
  const now = new Date().toISOString();
  const agents = snapshot.agents.map((agent) =>
    agentIds.has(agent.id)
      ? {
          ...agent,
          connectionStatus,
          mode: (connectionStatus === "disconnected" ? "paused" : "routine") as UiAgentRuntime["mode"],
          currentTask: connectionStatus === "connected" ? "Launched from guided flow" : "Stopped by runtime control",
          updatedAt: now,
          health: {
            ...agent.health,
            connectionStatus,
            hasBot: connectionStatus === "connected",
          },
        }
      : agent,
  );

  studioStore.reset({
    ...snapshot,
    agents,
    health: {
      ...snapshot.health,
      bots: {
        ...snapshot.health.bots,
        connected: agents.filter((agent) => agent.connectionStatus === "connected").length,
        total: agents.length,
      },
    },
  });
}

function runtimeStatusFromStore(): RuntimeStatusSnapshot {
  const snapshot = studioStore.getSnapshot();
  return {
    ok: true,
    capabilities: {
      launch: true,
      stop: true,
      restart: false,
    },
    minecraft: {
      status: snapshot.health.minecraft.status,
      message: snapshot.health.minecraft.message ?? "Mock Minecraft runtime ready",
      host: "127.0.0.1",
      port: 25565,
      checkedAt: new Date().toISOString(),
    },
    agents: snapshot.agents.map((agent) => ({
      agentId: agent.id,
      mode: agent.mode,
      connectionStatus: agent.connectionStatus ?? (agent.mode === "failed" ? "failed" : "connected"),
      hasBot: agent.mode !== "failed" && agent.mode !== "paused",
      currentTask: agent.currentTask,
      lastError: agent.lastError,
      position: agent.position,
      updatedAt: agent.updatedAt ?? new Date().toISOString(),
    })),
  };
}

function runtimeResult(
  agentId: string,
  connectionStatus: BotConnectionStatus,
  ok: boolean,
): RuntimeAgentControlResult {
  return {
    agentId,
    ok,
    connectionStatus,
    mode: connectionStatus === "failed" ? "failed" : connectionStatus === "disconnected" ? "paused" : "routine",
  };
}

function controlResponse(
  type: AgentControlResponse["command"]["type"],
  targetAgentId?: string,
  reason?: string,
): AgentControlResponse {
  return {
    ok: true,
    command: command(type, {}, targetAgentId, reason),
  };
}

function command(
  type: PendingDirectorCommand["type"],
  payload: Record<string, JsonValue>,
  targetAgentId?: string,
  reason?: string,
): PendingDirectorCommand {
  return {
    id: `mock-${type}-${Date.now()}`,
    type,
    requestedBy: "studio-web-mock",
    targetAgentId,
    reason,
    payload,
    timestamp: new Date().toISOString(),
  };
}

function createMockChatMessage(input: {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency: EventSeverity;
  visibility: Visibility;
  content: string;
}): AiChatMessage {
  return {
    id: `mock-chat-${Date.now()}`,
    senderId: input.senderId,
    recipientIds: input.recipientIds,
    topic: input.topic,
    urgency: input.urgency,
    visibility: input.visibility,
    content: input.content,
    timestamp: new Date().toISOString(),
  };
}

function response<T>(partial: Omit<MockDirectorResponse, "ok">): T {
  return {
    ok: true,
    ...partial,
  } as T;
}

async function parseBody(body: BodyInit | null | undefined): Promise<unknown> {
  if (!body) return {};
  if (typeof body === "string") return JSON.parse(body || "{}");
  if (body instanceof FormData) return Object.fromEntries(body.entries());
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  return {};
}

function apiPath(path: string): string {
  const origin = globalThis.location?.origin ?? "http://localhost";
  const url = new URL(path, origin);
  return url.pathname.replace(/^\/api/, "") || "/";
}

function isMockablePath(pathname: string): boolean {
  return (
    pathname === "/healthz" ||
    pathname === "/chat/messages" ||
    pathname.startsWith("/director/") ||
    pathname.startsWith("/runtime/")
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function severity(value: unknown): EventSeverity {
  return typeof value === "number" && value >= 1 && value <= 5
    ? (value as EventSeverity)
    : 3;
}

function visibility(value: unknown): Visibility {
  return value === "ai" || value === "human-team" || value === "recorder" || value === "public"
    ? value
    : "ai";
}

function recordPayload(value: unknown): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : { summary: "Mock director event", createdAt: isoAt(0) };
}
