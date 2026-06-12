import type { AgentMode } from "@mc-ai-video/contracts";

import type { AgentRegistry } from "../agents/registry";
import type {
  BotEventHandler,
  BotFactory,
  BotHandle,
  BotLifecycleEvent,
} from "./types";

export type BotConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";

export interface BotLifecycleSnapshot {
  agentId: string;
  status: BotConnectionStatus;
  lastEvent?: BotLifecycleEvent | "connect" | "disconnect";
  lastError?: string;
  updatedAt: string;
}

interface LifecycleRecord extends BotLifecycleSnapshot {
  disconnecting: boolean;
  handlers?: Partial<Record<BotLifecycleEvent, BotEventHandler>>;
}

export class BotLifecycleManager {
  private readonly records = new Map<string, LifecycleRecord>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly factory: BotFactory,
  ) {}

  async connect(agentId: string): Promise<BotHandle> {
    const config = this.registry.getConfig(agentId);
    if (!config) {
      throw new Error(`unknown agent: ${agentId}`);
    }

    this.setStatus(agentId, "connecting", "connect");
    const bot = await this.factory.connect(config);
    this.registry.attachBot(agentId, bot);
    this.wireBotEvents(agentId, bot);
    return bot;
  }

  async disconnect(agentId: string, reason = "studio disconnect"): Promise<void> {
    const record = this.ensureRecord(agentId);
    record.disconnecting = true;

    const bot = this.registry.getBot(agentId);
    if (bot) {
      bot.quit(reason);
      this.clearBotListeners(agentId, bot);
    }

    this.registry.detachBot(agentId);
    this.registry.updateMode(agentId, "paused");
    this.setStatus(agentId, "disconnected", "disconnect");
  }

  async reconnect(agentId: string): Promise<BotHandle> {
    await this.disconnect(agentId, "studio reconnect");
    return this.connect(agentId);
  }

  getStatus(agentId: string): BotLifecycleSnapshot {
    const record = this.records.get(agentId);
    if (record) {
      return { ...record };
    }

    return {
      agentId,
      status: "disconnected",
      updatedAt: new Date(0).toISOString(),
    };
  }

  private wireBotEvents(agentId: string, bot: BotHandle): void {
    const onSpawn = (): void => {
      const mode = this.registry.getConfig(agentId)?.mode ?? "routine";
      this.registry.updateMode(agentId, mode as AgentMode);
      this.setStatus(agentId, "connected", "spawn");
    };

    const onKicked = (reason?: unknown): void => {
      this.fail(agentId, "kicked", `kicked: ${formatUnknown(reason)}`);
    };

    const onError = (error?: unknown): void => {
      this.fail(agentId, "error", `bot error: ${formatUnknown(error)}`);
    };

    const onEnd = (): void => {
      const record = this.ensureRecord(agentId);
      this.clearBotListeners(agentId, bot);
      this.registry.detachBot(agentId);

      if (record.disconnecting) {
        this.registry.updateMode(agentId, "paused");
        this.setStatus(agentId, "disconnected", "end");
        return;
      }

      this.fail(agentId, "end", "bot ended unexpectedly");
    };

    const handlers: Partial<Record<BotLifecycleEvent, BotEventHandler>> = {
      spawn: onSpawn,
      kicked: onKicked,
      error: onError,
      end: onEnd,
    };

    for (const [event, handler] of Object.entries(handlers)) {
      bot.on(event as BotLifecycleEvent, handler);
    }

    const record = this.ensureRecord(agentId);
    record.handlers = handlers;
  }

  private fail(
    agentId: string,
    event: BotLifecycleEvent,
    error: string,
  ): void {
    console.warn(`[live-bot] ${agentId} ${event}: ${error}`);
    const bot = this.registry.getBot(agentId);
    if (bot) {
      this.clearBotListeners(agentId, bot);
      this.registry.detachBot(agentId);
    }

    this.registry.markError(agentId, error);
    const record = this.setStatus(agentId, "failed", event, error);
    record.disconnecting = false;
  }

  private clearBotListeners(agentId: string, bot: BotHandle): void {
    const handlers = this.records.get(agentId)?.handlers;
    if (!handlers) {
      return;
    }

    for (const [event, handler] of Object.entries(handlers)) {
      if (bot.off) {
        bot.off(event as BotLifecycleEvent, handler);
      } else {
        bot.removeListener?.(event as BotLifecycleEvent, handler);
      }
    }

    this.ensureRecord(agentId).handlers = undefined;
  }

  private setStatus(
    agentId: string,
    status: BotConnectionStatus,
    event?: BotLifecycleSnapshot["lastEvent"],
    error?: string,
  ): LifecycleRecord {
    const record = this.ensureRecord(agentId);
    record.status = status;
    record.lastEvent = event;
    record.lastError = error;
    record.updatedAt = new Date().toISOString();
    if (status !== "connecting") {
      record.disconnecting = false;
    }
    return record;
  }

  private ensureRecord(agentId: string): LifecycleRecord {
    const existing = this.records.get(agentId);
    if (existing) {
      return existing;
    }

    const record: LifecycleRecord = {
      agentId,
      status: "disconnected",
      updatedAt: new Date().toISOString(),
      disconnecting: false,
    };
    this.records.set(agentId, record);
    return record;
  }
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "unknown";
  }
  return JSON.stringify(value);
}
