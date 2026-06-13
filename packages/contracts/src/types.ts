export type AgentMode = "paused" | "routine" | "planning" | "acting" | "failed";

export type Visibility = "ai" | "human-team" | "recorder" | "public";

export type EventSeverity = 1 | 2 | 3 | 4 | 5;

export type RuntimeServiceStatus = "online" | "degraded" | "offline" | "unknown";

export type BotConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | Position
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Position {
  x: number;
  y: number;
  z: number;
  world?: string;
}

export interface AgentBehaviorSettings {
  riskTolerance?: "low" | "medium" | "high";
  teamwork?: "solo" | "balanced" | "team-first";
  initiative?: "low" | "medium" | "high";
}

export interface AgentConfig {
  id: string;
  name: string;
  account: {
    username: string;
    auth?: "offline" | "microsoft";
  };
  role: string;
  team?: string;
  subteam?: string;
  leader?: boolean;
  enabled?: boolean;
  personality?: string;
  behavior?: AgentBehaviorSettings;
  mode?: AgentMode;
  routine?: string;
  allowedActions: string[];
  providerRef: string;
  visibility?: Visibility;
}

export interface RuntimeAgentSnapshot {
  agentId: string;
  mode: AgentMode;
  connectionStatus: BotConnectionStatus;
  hasBot: boolean;
  currentTask?: string;
  lastError?: string;
  position?: Position;
  updatedAt: string;
}

export interface RuntimeCapabilities {
  launch: boolean;
  stop: boolean;
  restart: boolean;
}

export interface RuntimeServiceSnapshot {
  status: RuntimeServiceStatus;
  message?: string;
  host?: string;
  port?: number;
  checkedAt?: string;
}

export interface RuntimeStatusSnapshot {
  ok: boolean;
  capabilities: RuntimeCapabilities;
  minecraft: RuntimeServiceSnapshot;
  agents: RuntimeAgentSnapshot[];
}

export interface RuntimeLaunchRequest {
  agentIds: string[];
  scenarioGoal?: string;
  requestedBy?: string;
}

export interface RuntimeAgentControlResult {
  agentId: string;
  ok: boolean;
  connectionStatus: BotConnectionStatus;
  mode?: AgentMode;
  error?: string;
}

export interface RuntimeLaunchResponse {
  ok: boolean;
  results: RuntimeAgentControlResult[];
}

export interface GameEvent {
  id: string;
  type: string;
  actorId?: string;
  targetId?: string;
  location?: Position;
  severity: EventSeverity;
  visibility: Visibility;
  payload: Record<string, JsonValue>;
  timestamp: string;
}

export interface AiChatMessage {
  id: string;
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility: Visibility;
  content: string;
  timestamp: string;
}

export interface ActionRequest {
  id: string;
  agentId: string;
  action: string;
  params: Record<string, JsonValue>;
  requestedBy?: string;
  source?: string;
  targetKey?: string;
  timeoutMs?: number;
  createdAt: string;
}

export interface ActionResult {
  requestId: string;
  agentId: string;
  action: string;
  ok: boolean;
  startedAt: string;
  completedAt: string;
  error?: string;
  data?: Record<string, JsonValue>;
  params?: Record<string, JsonValue>;
  requestedBy?: string;
  source?: string;
  targetKey?: string;
}

export const PLUGIN_BRIDGE_SCHEMA_VERSION = "v1";

export const PLUGIN_SHARED_SECRET_HEADER = "x-mcas-plugin-secret";

export const PLUGIN_EVENT_ENDPOINT = "/plugin/events";

export type PluginBridgeSchemaVersion = typeof PLUGIN_BRIDGE_SCHEMA_VERSION;

export type PluginChatChannel = "ai" | "human-team";

export type PluginPrivateChatVisibility = Extract<Visibility, "ai" | "human-team">;

export type PluginServerEventType =
  | "team_assignment"
  | "ai_private_chat"
  | "human_team_chat"
  | "player_join"
  | "player_leave"
  | "player_death"
  | "player_damage"
  | "player_chat"
  | "block_break";

export interface PluginPlayerRef {
  uuid: string;
  username: string;
  teamId?: string;
  isRecorder?: boolean;
}

export interface PluginTeamAssignment {
  schemaVersion: PluginBridgeSchemaVersion;
  teamId: string;
  memberUuids: string[];
  assignedBy?: PluginPlayerRef;
  visibility: Extract<Visibility, "human-team" | "recorder">;
  timestamp: string;
}

export interface PluginPrivateChatMessage {
  schemaVersion: PluginBridgeSchemaVersion;
  channel: PluginChatChannel;
  sender: PluginPlayerRef;
  recipientUuids?: string[];
  teamId?: string;
  visibility: PluginPrivateChatVisibility;
  content: string;
  timestamp: string;
}

export interface PluginRecorderVisibility {
  schemaVersion: PluginBridgeSchemaVersion;
  recorderUuid: string;
  teamIds?: string[];
  canSeeAiPrivateChat: boolean;
  canSeeHumanTeamChat: boolean;
  canSeePublicChat: boolean;
  canSeeServerEvents: boolean;
  timestamp: string;
}

export interface PluginServerEvent {
  schemaVersion: PluginBridgeSchemaVersion;
  serverId: string;
  eventId: string;
  type: PluginServerEventType;
  actor?: PluginPlayerRef;
  target?: PluginPlayerRef;
  location?: Position;
  visibility: Visibility;
  severity: EventSeverity;
  payload: Record<string, JsonValue>;
  timestamp: string;
}

export type PluginRequestHeaders = Record<string, string | string[] | undefined>;

export function createPluginSharedSecretHeaders(
  sharedSecret: string,
): Record<string, string> {
  return {
    [PLUGIN_SHARED_SECRET_HEADER]: sharedSecret,
  };
}

export function readPluginSharedSecret(
  headers: PluginRequestHeaders,
): string | undefined {
  const expectedHeader = PLUGIN_SHARED_SECRET_HEADER.toLowerCase();

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== expectedHeader) {
      continue;
    }

    return Array.isArray(value) ? value[0] : value;
  }

  return undefined;
}

export function hasPluginSharedSecret(
  headers: PluginRequestHeaders,
  expectedSecret: string,
): boolean {
  const receivedSecret = readPluginSharedSecret(headers);
  return expectedSecret.length > 0 && receivedSecret === expectedSecret;
}

export type ActionRiskLevel = "none" | "low" | "medium" | "high";

export type ActionStatus =
  | "accepted"
  | "rejected"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "canceled";

export interface InventoryItemSnapshot {
  name: string;
  count: number;
  slot?: number;
}

export type EntityKind =
  | "player"
  | "hostile"
  | "passive"
  | "item"
  | "unknown";

export interface EntitySnapshot {
  id: string;
  kind: EntityKind;
  name?: string;
  username?: string;
  position?: Position;
  distance?: number;
}

export interface PerceptionSnapshot {
  agentId: string;
  timestamp: string;
  health?: number;
  food?: number;
  position?: Position;
  inventory: InventoryItemSnapshot[];
  nearbyPlayers: EntitySnapshot[];
  nearbyMobs: EntitySnapshot[];
  nearbyItems: EntitySnapshot[];
  recentEvents: GameEvent[];
}
