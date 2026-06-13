import { useSyncExternalStore } from "react";
import type {
  AgentConfig,
  AiChatMessage,
  GameEvent,
  JsonValue,
  RuntimeStatusSnapshot,
} from "@mc-ai-video/contracts";

import type { ApiErrorShape } from "../api/client";
import type {
  PendingAgentStateUpdate,
  PendingStudioEventEnvelope,
  UiAgentRuntime,
  UiHealthSnapshot,
  UiSessionSummary,
} from "../types";
import type { DashboardConnectionState } from "../ws/dashboardClient";

export interface StudioState {
  session: UiSessionSummary | null;
  agents: UiAgentRuntime[];
  events: GameEvent[];
  chat: AiChatMessage[];
  connection: DashboardConnectionState;
  health: UiHealthSnapshot;
  api: {
    loading: boolean;
    error?: ApiErrorShape;
    lastCheckedAt?: string;
  };
}

export class StudioStore {
  private state: StudioState;
  private readonly listeners = new Set<() => void>();

  constructor(initialState: StudioState = createInitialStudioState()) {
    this.state = initialState;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StudioState => this.state;

  setSession(session: UiSessionSummary | null): void {
    this.setState({ session });
  }

  setAgents(agents: AgentConfig[]): void {
    this.setState({
      agents: agents.map((agent) => ({
        ...agent,
        mode: agent.mode ?? "routine",
      })),
      health: {
        ...this.state.health,
        bots: {
          ...this.state.health.bots,
          total: agents.length,
        },
      },
    });
  }

  upsertAgentState(update: PendingAgentStateUpdate): void {
    const agents = [...this.state.agents];
    const index = agents.findIndex((agent) => agent.id === update.agentId);

    if (index >= 0) {
      agents[index] = { ...agents[index], ...update, id: agents[index].id };
    } else {
      agents.unshift(createUnknownAgent(update));
    }

    this.setState({
      agents,
      health: {
        ...this.state.health,
        bots: {
          ...this.state.health.bots,
          connected: agents.filter((agent) => agent.mode !== "failed").length,
          total: Math.max(this.state.health.bots.total, agents.length),
        },
      },
    });
  }

  appendEvent(event: GameEvent): void {
    this.setState({ events: limitNewest([event, ...this.state.events], 300) });
  }

  appendChat(message: AiChatMessage): void {
    this.setState({ chat: limitNewest([message, ...this.state.chat], 200) });
  }

  setConnection(connection: DashboardConnectionState): void {
    this.setState({ connection });
  }

  setHealth(health: UiHealthSnapshot): void {
    this.setState({
      health: {
        ...health,
        bots: {
          ...health.bots,
          connected: this.state.health.bots.connected,
          total: Math.max(health.bots.total, this.state.agents.length),
        },
      },
    });
  }

  setRuntimeStatus(runtime: RuntimeStatusSnapshot): void {
    const runtimeByAgentId = new Map(
      runtime.agents.map((agent) => [agent.agentId, agent]),
    );
    const agents = this.state.agents.map((agent) => {
      const update = runtimeByAgentId.get(agent.id);
      if (!update) return agent;

      return {
        ...agent,
        mode: update.mode,
        connectionStatus: update.connectionStatus,
        currentTask: update.currentTask ?? agent.currentTask,
        lastError: update.lastError,
        position: update.position,
        updatedAt: update.updatedAt,
        health: compactRuntimeHealth({
          ...agent.health,
          connectionStatus: update.connectionStatus,
          hasBot: update.hasBot,
          lastError: update.lastError,
          position: update.position,
        }),
      };
    });
    const connected = runtime.agents.filter(
      (agent) => agent.connectionStatus === "connected" || agent.connectionStatus === "connecting",
    ).length;

    this.setState({
      agents,
      health: {
        ...this.state.health,
        minecraft: {
          status: runtime.minecraft.status,
          message: runtime.minecraft.message,
        },
        bots: {
          connected,
          total: Math.max(runtime.agents.length, agents.length),
          message: runtime.capabilities.launch
            ? "Runtime lifecycle controller attached"
            : "Runtime lifecycle controller unavailable",
        },
      },
    });
  }

  setApiStatus(api: StudioState["api"]): void {
    this.setState({ api });
  }

  applyEnvelope(envelope: PendingStudioEventEnvelope): void {
    // WebSocket events are folded into the store in one place so HTTP snapshots can later share the same state path.
    switch (envelope.type) {
      case "game.event":
        this.appendEvent(envelope.payload);
        break;
      case "chat.message":
        this.appendChat(envelope.payload);
        break;
      case "agent.state":
        this.upsertAgentState(envelope.payload);
        break;
      case "action.result":
      case "director.command":
        break;
      default:
        envelope satisfies never;
    }
  }

  reset(nextState: StudioState = createInitialStudioState()): void {
    this.state = nextState;
    this.emit();
  }

  private setState(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const studioStore = new StudioStore();

export function useStudioStore<T>(selector: (state: StudioState) => T): T {
  return useSyncExternalStore(
    studioStore.subscribe,
    () => selector(studioStore.getSnapshot()),
    () => selector(studioStore.getSnapshot()),
  );
}

export function createInitialStudioState(): StudioState {
  return {
    session: null,
    agents: [],
    events: [],
    chat: [],
    connection: {
      phase: "idle",
      attempts: 0,
    },
    health: {
      backend: { status: "unknown" },
      minecraft: { status: "unknown" },
      bots: { connected: 0, total: 0 },
      llmQueue: { status: "unknown", active: 0, queued: 0 },
    },
    api: {
      loading: false,
    },
  };
}

function createUnknownAgent(update: PendingAgentStateUpdate): UiAgentRuntime {
  return {
    id: update.agentId,
    name: update.agentId,
    account: {
      username: update.agentId,
      auth: "offline",
    },
    role: "unknown",
    mode: update.mode,
    allowedActions: [],
    providerRef: "unknown",
    currentTask: update.currentTask,
    health: update.health,
    updatedAt: update.updatedAt,
  };
}

function limitNewest<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(0, max) : items;
}

function compactRuntimeHealth(
  source: Record<string, JsonValue | undefined>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined,
    ),
  );
}
