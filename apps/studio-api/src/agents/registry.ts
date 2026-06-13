import type { AgentConfig, AgentMode } from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";

export interface AgentRuntimeView {
  id: string;
  config: AgentConfig;
  mode: AgentMode;
  hasBot: boolean;
  lastError?: string;
  updatedAt: string;
}

interface AgentRecord {
  config: AgentConfig;
  mode: AgentMode;
  bot?: BotHandle;
  lastError?: string;
  updatedAt: string;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  constructor(configs: AgentConfig[] = []) {
    for (const config of configs) {
      this.register(config);
    }
  }

  register(config: AgentConfig): AgentRuntimeView {
    if (this.agents.has(config.id)) {
      throw new Error(`agent already registered: ${config.id}`);
    }

    const record: AgentRecord = {
      config,
      mode: config.mode ?? "paused",
      updatedAt: new Date().toISOString(),
    };
    this.agents.set(config.id, record);
    return toView(config.id, record);
  }

  get(agentId: string): AgentRuntimeView | undefined {
    const record = this.agents.get(agentId);
    return record ? toView(agentId, record) : undefined;
  }

  list(): AgentRuntimeView[] {
    return Array.from(this.agents.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agentId, record]) => toView(agentId, record));
  }

  getConfig(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId)?.config;
  }

  updateConfig(config: AgentConfig): AgentRuntimeView {
    const record = this.requireRecord(config.id);
    record.config = config;
    if (config.mode) {
      record.mode = config.mode;
    }
    record.updatedAt = new Date().toISOString();
    return toView(config.id, record);
  }

  updateMode(agentId: string, mode: AgentMode): AgentRuntimeView {
    const record = this.requireRecord(agentId);
    record.mode = mode;
    record.updatedAt = new Date().toISOString();
    return toView(agentId, record);
  }

  attachBot(agentId: string, bot: BotHandle): AgentRuntimeView {
    const record = this.requireRecord(agentId);
    record.bot = bot;
    record.lastError = undefined;
    record.updatedAt = new Date().toISOString();
    return toView(agentId, record);
  }

  detachBot(agentId: string): AgentRuntimeView {
    const record = this.requireRecord(agentId);
    record.bot = undefined;
    record.updatedAt = new Date().toISOString();
    return toView(agentId, record);
  }

  getBot(agentId: string): BotHandle | undefined {
    return this.agents.get(agentId)?.bot;
  }

  markError(agentId: string, error: string): AgentRuntimeView {
    const record = this.requireRecord(agentId);
    record.mode = "failed";
    record.lastError = error;
    record.updatedAt = new Date().toISOString();
    return toView(agentId, record);
  }

  private requireRecord(agentId: string): AgentRecord {
    const record = this.agents.get(agentId);
    if (!record) {
      throw new Error(`unknown agent: ${agentId}`);
    }
    return record;
  }
}

function toView(agentId: string, record: AgentRecord): AgentRuntimeView {
  return {
    id: agentId,
    config: record.config,
    mode: record.mode,
    hasBot: record.bot !== undefined,
    lastError: record.lastError,
    updatedAt: record.updatedAt,
  };
}
