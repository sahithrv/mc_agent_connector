import type { AgentConfig, Position } from "@mc-ai-video/contracts";

export type BotLifecycleEvent = "spawn" | "kicked" | "error" | "end";

export type BotEventHandler = (...args: unknown[]) => void;

export interface BotEventSource {
  on(event: BotLifecycleEvent, handler: BotEventHandler): this;
  off?(event: BotLifecycleEvent, handler: BotEventHandler): this;
  removeListener?(event: BotLifecycleEvent, handler: BotEventHandler): this;
}

export interface BotVector extends Position {
  distanceTo?(other: Position): number;
}

export interface BotEntity {
  id: number | string;
  type?: string;
  kind?: string;
  name?: string;
  username?: string;
  mobType?: string;
  displayName?: string;
  position?: BotVector;
}

export interface BotInventoryItem {
  name: string;
  count: number;
  slot?: number;
}

export interface BotInventory {
  items(): BotInventoryItem[];
  emptySlotCount?(): number;
}

export interface BotBlock {
  name: string;
  position: BotVector;
  diggable?: boolean;
}

export interface BotPathfinder {
  goto(goal: unknown): Promise<void>;
  setGoal?(goal: unknown, dynamic?: boolean): void;
  stop?(): void;
}

export interface BotCollectBlock {
  collect(entity: BotEntity): Promise<void>;
}

export interface BotHandle extends BotEventSource {
  username: string;
  health?: number;
  food?: number;
  entity?: BotEntity;
  entities?: Record<string, BotEntity>;
  inventory?: BotInventory;
  pathfinder?: BotPathfinder;
  collectBlock?: BotCollectBlock;
  chat(message: string): void | Promise<void>;
  quit(reason?: string): void;
  blockAt?(position: Position): BotBlock | null;
  canDigBlock?(block: BotBlock): boolean;
  dig?(block: BotBlock): Promise<void>;
  attack?(entity: BotEntity): void | Promise<void>;
}

export interface LocalServerConnection {
  host: string;
  port: number;
  version?: string;
}

export interface BotFactory {
  connect(config: AgentConfig): Promise<BotHandle>;
}

export interface MineflayerCreateBotOptions {
  host: string;
  port: number;
  username: string;
  auth: "offline" | "microsoft";
  version?: string;
}

export type MineflayerCreateBot = (
  options: MineflayerCreateBotOptions,
) => BotHandle;
