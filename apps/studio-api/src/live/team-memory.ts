import type { Position } from "@mc-ai-video/contracts";

import type { BotInventoryItem } from "../bots/types";
import type { PerceptionSnapshot, RoutineActionIntent } from "../routines";
import type { SubteamDirectory } from "./subteams";

export type TeamMemoryKind = "inventory" | "activity" | "observation" | "need";

export interface TeamMemoryEntry {
  id: string;
  teamId: string;
  kind: TeamMemoryKind;
  agentId?: string;
  text: string;
  timestamp: number;
  expiresAt: number;
  importance: number;
  key?: string;
  action?: string;
  target?: string;
  position?: Position;
}

export interface TeamMemoryRecentOptions {
  maxEntries?: number;
  includeSelf?: boolean;
  log?: boolean;
}

export interface TeamMemoryRecentView {
  teamId: string;
  entries: TeamMemoryEntry[];
  summary: string;
}

export type TeamInventorySummaryInput =
  | string
  | Record<string, number>
  | BotInventoryItem[]
  | {
    tools?: string[];
    seeds?: number;
    food?: number;
  };

export interface TeamActivityInput {
  action: string;
  params?: RoutineActionIntent["params"];
}

export interface TeamObservationInput {
  category?: "resource" | "hazard" | "site" | "target" | "path" | "status";
  text?: string;
  type?: string;
  target?: string;
  position?: Position;
  key?: string;
  importance?: number;
}

export interface TeamNeedInput {
  text: string;
  key?: string;
  importance?: number;
}

export interface TeamMemoryStoreOptions {
  subteams: SubteamDirectory;
  maxEntriesPerTeam?: number;
  ttlMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

const DEFAULT_MAX_ENTRIES_PER_TEAM = 80;
const DEFAULT_TTL_MS = 90_000;
const DEFAULT_RECENT_COUNT = 10;
const MAX_SUMMARY_CHARS = 520;
const MAX_INVENTORY_ITEMS = 8;

const USEFUL_INVENTORY_PATTERN =
  /pickaxe|axe|shovel|hoe|sword|bow|shield|dirt|cobblestone|stone|planks|log|wood|brick|sand|gravel|glass|seed|sapling|wheat|bread|apple|potato|carrot|beef|pork|chicken|mutton|coal|iron|copper|ore|ingot|stick|torch/i;
const USEFUL_BLOCK_PATTERN = /stone|deepslate|dirt|gravel|coal_ore|iron_ore|copper_ore|log|wood|ore|crop|wheat|carrot|potato/i;
const USEFUL_ITEM_PATTERN = /item|cobblestone|dirt|seed|log|planks|stone|ore|ingot|coal|wheat|carrot|potato|wood|torch/i;

export class TeamMemoryStore {
  private readonly channels = new Map<string, TeamMemoryEntry[]>();
  private readonly maxEntriesPerTeam: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private sequence = 0;

  constructor(private readonly options: TeamMemoryStoreOptions) {
    this.maxEntriesPerTeam = options.maxEntriesPerTeam ?? DEFAULT_MAX_ENTRIES_PER_TEAM;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message) => console.log(message));
    this.ensureActiveChannels();
  }

  channelIds(): string[] {
    this.ensureActiveChannels();
    return [...this.channels.keys()].sort((left, right) => left.localeCompare(right));
  }

  recordInventory(agentId: string, inventorySummary: TeamInventorySummaryInput | undefined): void {
    const teamId = this.teamIdForAgent(agentId);
    if (!teamId || inventorySummary === undefined) return;

    const summary = summarizeInventory(inventorySummary);
    if (!summary) return;

    this.upsert(teamId, {
      kind: "inventory",
      agentId,
      key: `inventory:${agentId}`,
      text: `${agentId} has ${summary}`,
      importance: 4,
    });
    this.log(`[team-memory] ${teamId} ${agentId} inventory: ${summary}`);
  }

  recordActivity(agentId: string, activity: string | RoutineActionIntent | TeamActivityInput | undefined): void {
    const teamId = this.teamIdForAgent(agentId);
    if (!teamId || !activity) return;

    const normalized = normalizeActivity(activity);
    if (!normalized) return;

    this.upsert(teamId, {
      kind: "activity",
      agentId,
      key: `activity:${agentId}`,
      text: `${agentId} doing ${normalized.text}`,
      importance: normalized.importance,
      action: normalized.action,
      target: normalized.target,
      position: normalized.position,
    });
    this.log(`[team-memory] ${teamId} ${agentId} doing: ${normalized.text}`);
  }

  recordObservation(agentId: string, observation: string | TeamObservationInput | undefined): void {
    const teamId = this.teamIdForAgent(agentId);
    if (!teamId || !observation) return;

    const normalized = normalizeObservation(agentId, observation);
    if (!normalized) return;

    this.upsert(teamId, {
      kind: "observation",
      agentId,
      key: normalized.key,
      text: normalized.text,
      importance: normalized.importance,
      target: normalized.target,
      position: normalized.position,
    });
    this.log(`[team-memory] ${teamId} ${agentId} observed: ${normalized.text}`);
  }

  recordNeed(teamId: string, need: string | TeamNeedInput | undefined): void {
    if (!need) return;

    const text = typeof need === "string" ? need.trim() : need.text.trim();
    if (!text) return;

    const normalized = text.toLowerCase().startsWith("need") ? text : `need ${text}`;
    this.upsert(teamId, {
      kind: "need",
      key: typeof need === "string" ? `need:${stableTextKey(text)}` : need.key ?? `need:${stableTextKey(text)}`,
      text: normalized.includes("=") ? normalized : normalized.replace(/^need\s+/i, "need="),
      importance: typeof need === "string" ? 5 : need.importance ?? 5,
    });
    this.log(`[team-memory] ${teamId} need: ${normalized}`);
  }

  recordPerception(
    agentId: string,
    perception: PerceptionSnapshot,
    inventorySummary?: TeamInventorySummaryInput,
  ): void {
    this.recordInventory(agentId, inventorySummary ?? perception.inventory);

    const usefulBlocks = perception.visibleBlocks.filter((block) =>
      USEFUL_BLOCK_PATTERN.test(block.type) && block.safe !== false && block.belowAgent !== true,
    );
    for (const block of uniqueBy(usefulBlocks, (block) => block.type).slice(0, 4)) {
      this.recordObservation(agentId, {
        category: "resource",
        type: block.type,
        position: block.position,
        key: `resource:${block.type}:${positionKey(block.position)}`,
        text: `${block.type} at ${formatPosition(block.position)}`,
        importance: /ore|coal|iron|copper/i.test(block.type) ? 4 : 3,
      });
    }

    for (const entity of perception.nearbyEntities.slice(0, 8)) {
      if (entity.hostile === true) {
        this.recordObservation(agentId, {
          category: "hazard",
          type: entity.type,
          position: entity.position,
          key: `hazard:${entity.type}:${entity.id}`,
          text: `${entity.type} hazard${entity.position ? ` at ${formatPosition(entity.position)}` : ""}`,
          importance: 5,
        });
        continue;
      }

      if (USEFUL_ITEM_PATTERN.test(entity.type)) {
        this.recordObservation(agentId, {
          category: "resource",
          type: entity.type,
          position: entity.position,
          key: `item:${entity.type}:${entity.id}`,
          text: `${entity.type} dropped item${entity.position ? ` at ${formatPosition(entity.position)}` : ""}`,
          importance: 3,
        });
      }
    }

    for (const player of perception.nearbyPlayers.slice(0, 6)) {
      if (!player.threatening) continue;
      this.recordObservation(agentId, {
        category: "target",
        target: player.name,
        key: `target:${player.name.toLowerCase()}`,
        text: `target ${player.name} visible at distance ${round(player.distance ?? 0)}`,
        importance: 5,
      });
    }
  }

  recentForAgent(agentId: string, options: TeamMemoryRecentOptions = {}): TeamMemoryRecentView | undefined {
    const teamId = this.teamIdForAgent(agentId);
    if (!teamId) return undefined;

    const channel = this.prunedChannel(teamId);
    const includeSelf = options.includeSelf ?? true;
    const maxEntries = options.maxEntries ?? DEFAULT_RECENT_COUNT;
    const candidates = includeSelf
      ? channel
      : channel.filter((entry) => entry.agentId !== agentId);
    const entries = candidates
      .slice(-Math.max(maxEntries * 3, maxEntries))
      .sort((left, right) =>
        right.importance - left.importance
        || right.timestamp - left.timestamp
        || left.text.localeCompare(right.text),
      )
      .slice(0, maxEntries)
      .sort((left, right) => left.timestamp - right.timestamp)
      .map(cloneEntry);
    const summary = truncateSummary(entries.map((entry) => entry.text).join("; "));

    if ((options.log ?? true) && summary) {
      this.log(`[team-memory] ${teamId} recent for ${agentId}: ${summary}`);
    }

    return { teamId, entries, summary };
  }

  private upsert(
    teamId: string,
    input: Omit<TeamMemoryEntry, "id" | "teamId" | "timestamp" | "expiresAt">,
  ): void {
    const now = this.now();
    const channel = this.prunedChannel(teamId);
    const entry: TeamMemoryEntry = {
      ...input,
      id: `${teamId}:${++this.sequence}`,
      teamId,
      timestamp: now,
      expiresAt: now + this.ttlMs,
    };

    if (entry.key) {
      const existingIndex = channel.findIndex((candidate) => candidate.key === entry.key);
      if (existingIndex >= 0) channel.splice(existingIndex, 1);
    }

    channel.push(entry);
    while (channel.length > this.maxEntriesPerTeam) channel.shift();
    this.channels.set(teamId, channel);
  }

  private prunedChannel(teamId: string): TeamMemoryEntry[] {
    this.ensureActiveChannels();
    const now = this.now();
    const channel = this.channels.get(teamId) ?? [];
    const live = channel.filter((entry) => entry.expiresAt > now);
    if (live.length !== channel.length) this.channels.set(teamId, live);
    return live;
  }

  private ensureActiveChannels(): void {
    for (const team of this.options.subteams.list()) {
      if (!this.channels.has(team.id)) this.channels.set(team.id, []);
    }
  }

  private teamIdForAgent(agentId: string): string | undefined {
    const team = this.options.subteams.teamForAgent(agentId);
    if (team && !this.channels.has(team.id)) this.channels.set(team.id, []);
    return team?.id;
  }
}

export function teamMemoryPromptMemories(
  memory: TeamMemoryStore | undefined,
  agentId: string,
): Array<{ id: string; summary: string; importance: 5 }> {
  const recent = memory?.recentForAgent(agentId, { maxEntries: 8, log: false });
  if (!recent?.summary) return [];
  return [{
    id: "recent-team-memory",
    summary: `Recent team memory (${recent.teamId}): ${recent.summary}`,
    importance: 5,
  }];
}

function summarizeInventory(input: TeamInventorySummaryInput): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? truncateSummary(trimmed) : undefined;
  }

  const counts = new Map<string, number>();

  if (Array.isArray(input)) {
    for (const item of input) {
      addInventoryItem(counts, item.name, item.count);
    }
  } else if (isPerceivedInventory(input)) {
    for (const tool of input.tools ?? []) addInventoryItem(counts, tool, 1);
    if ((input.seeds ?? 0) > 0) addInventoryItem(counts, "seeds", input.seeds ?? 0);
    if ((input.food ?? 0) > 0) addInventoryItem(counts, "food", input.food ?? 0);
  } else {
    for (const [name, count] of Object.entries(input)) addInventoryItem(counts, name, count);
  }

  const values = [...counts.entries()]
    .sort((left, right) => usefulItemRank(left[0]) - usefulItemRank(right[0]) || left[0].localeCompare(right[0]))
    .slice(0, MAX_INVENTORY_ITEMS)
    .map(([name, count]) => `${name}=${count}`);
  return values.length > 0 ? values.join(" ") : undefined;
}

function addInventoryItem(counts: Map<string, number>, name: string, count: number): void {
  const normalized = name.trim();
  if (!normalized || count <= 0 || !USEFUL_INVENTORY_PATTERN.test(normalized)) return;
  counts.set(normalized, (counts.get(normalized) ?? 0) + count);
}

function usefulItemRank(name: string): number {
  if (/planks|log|wood|cobblestone|stone|dirt|sand|gravel|glass|brick/i.test(name)) return 1;
  if (/seed|sapling|wheat|bread|apple|potato|carrot|beef|pork|chicken|mutton|food/i.test(name)) return 2;
  if (/pickaxe|axe|shovel|hoe|sword|bow|shield/i.test(name)) return 3;
  return 4;
}

function isPerceivedInventory(value: Record<string, number> | { tools?: string[]; seeds?: number; food?: number }): value is { tools?: string[]; seeds?: number; food?: number } {
  return Array.isArray((value as { tools?: unknown }).tools)
    || typeof (value as { seeds?: unknown }).seeds === "number"
    || typeof (value as { food?: unknown }).food === "number";
}

function normalizeActivity(activity: string | RoutineActionIntent | TeamActivityInput): {
  action: string;
  text: string;
  importance: number;
  target?: string;
  position?: Position;
} | undefined {
  if (typeof activity === "string") {
    const trimmed = activity.trim();
    return trimmed ? { action: trimmed, text: trimmed, importance: 3 } : undefined;
  }

  const action = activity.action.trim();
  if (!action) return undefined;

  const params = activity.params ?? {};
  const position = positionParam(params.position);
  const target = targetFromParams(action, params, position);
  return {
    action,
    text: target ? `${action} ${target}` : action,
    target,
    position,
    importance: activityImportance(action),
  };
}

function normalizeObservation(agentId: string, observation: string | TeamObservationInput): {
  text: string;
  key?: string;
  target?: string;
  position?: Position;
  importance: number;
} | undefined {
  if (typeof observation === "string") {
    const text = observation.trim();
    return text ? { text, key: `observation:${agentId}:${stableTextKey(text)}`, importance: 3 } : undefined;
  }

  const text = observation.text
    ?? [
      observation.category,
      observation.type,
      observation.target,
      observation.position ? `at ${formatPosition(observation.position)}` : undefined,
    ].filter(Boolean).join(" ");
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return {
    text: trimmed,
    key: observation.key ?? `${observation.category ?? "observation"}:${agentId}:${stableTextKey(trimmed)}`,
    target: observation.target ?? observation.type,
    position: observation.position,
    importance: observation.importance ?? (observation.category === "hazard" || observation.category === "target" ? 5 : 3),
  };
}

function targetFromParams(
  action: string,
  params: RoutineActionIntent["params"],
  position: Position | undefined,
): string | undefined {
  const block = stringParam(params.block);
  if (block) return block;
  const item = stringParam(params.item) ?? stringParam(params.itemName);
  if (item) return item;
  const entityType = stringParam(params.entityType);
  if (entityType) return entityType;
  const username = stringParam(params.username);
  if (username) return username;
  const entityId = stringParam(params.entityId);
  if (entityId && action !== "collect_item") return entityId;
  if (position) return formatPosition(position);
  if (entityId) return entityId;
  return undefined;
}

function activityImportance(action: string): number {
  if (action === "attack_entity") return 5;
  if (["mine_block", "collect_item", "place_block", "move_to"].includes(action)) return 4;
  if (action === "idle") return 1;
  return 3;
}

function uniqueBy<T>(values: T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function cloneEntry(entry: TeamMemoryEntry): TeamMemoryEntry {
  return {
    ...entry,
    position: entry.position ? { ...entry.position } : undefined,
  };
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function positionParam(value: unknown): Position | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<Position>;
  return typeof source.x === "number" && typeof source.y === "number" && typeof source.z === "number"
    ? { x: source.x, y: source.y, z: source.z, world: source.world }
    : undefined;
}

function stableTextKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_:-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function positionKey(position: Position): string {
  return `${position.world ?? ""}:${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}

function formatPosition(position: Position): string {
  return `${round(position.x)},${round(position.y)},${round(position.z)}${position.world ? `@${position.world}` : ""}`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncateSummary(value: string): string {
  return value.length <= MAX_SUMMARY_CHARS ? value : `${value.slice(0, MAX_SUMMARY_CHARS - 3)}...`;
}
