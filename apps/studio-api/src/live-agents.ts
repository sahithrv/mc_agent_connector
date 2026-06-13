import { createBot } from "mineflayer";
import { connect as connectSocket } from "node:net";

import type {
  AgentConfig,
  JsonValue,
  RuntimeAgentControlResult,
  RuntimeAgentSnapshot,
  RuntimeLaunchRequest,
  RuntimeServiceSnapshot,
} from "@mc-ai-video/contracts";

import { AgentRegistry } from "./agents/registry";
import { createMineflayerBotFactory } from "./bots/factory";
import { BotLifecycleManager, type BotConnectionStatus } from "./bots/lifecycle";
import type { MineflayerCreateBot } from "./bots/types";
import { loadAgentConfigs } from "./config/agents";
import { loadLocalEnvFiles } from "./config/env";
import { formatStartupError } from "./config/errors";
import { loadStudioConfig } from "./config/studio";
import { StudioEventBus } from "./events/bus";
import { createLiveAgentRuntime } from "./live/runtime";
import { agentModeForConnection, type RuntimeController } from "./runtime/routes";
import type { AgentScheduler } from "./scheduler/scheduler";
import { createApp } from "./server/app";

interface LiveLaunchOptions {
  host: string;
  port: number;
  version?: string;
  batchSize: number;
  batchDelayMs: number;
  spawnTimeoutMs: number;
}

export async function main(): Promise<void> {
  try {
    loadLocalEnvFiles();
    const launch = readLaunchOptions();
    const studioConfig = await loadStudioConfig();
    const agents = await loadAgentConfigs();
    warnIfProviderEnvMissing(agents);
    const eventBus = new StudioEventBus();
    const registry = new AgentRegistry(agents);
    const autoConnectAgents = shouldAutoConnectAgents();
    const lifecycle = new BotLifecycleManager(
      registry,
      createMineflayerBotFactory({
        server: {
          host: launch.host,
          port: launch.port,
          version: launch.version,
        },
        createBot: createBot as unknown as MineflayerCreateBot,
      }),
    );
    const live = createLiveAgentRuntime({
      agents,
      registry,
      eventBus,
      tickMs: studioConfig.tickRates.schedulerMs,
      maxConcurrentActions: readIntegerEnv("LIVE_AGENT_MAX_ACTIONS", 8, 1, 20),
      maxPlanningSlots: studioConfig.llm.maxConcurrency,
      planningCooldownMs: readIntegerEnv("LIVE_AGENT_PLANNING_COOLDOWN_MS", 8_000, 0, 120_000),
      connectAgent: async (agent) => {
        await lifecycle.connect(agent.id);
        console.log(`started ${agent.id} as ${agent.account.username}`);
      },
    });
    if (!autoConnectAgents) {
      for (const agent of agents) {
        live.scheduler.pauseAgent(agent.id);
      }
    }
    const runtimeController = createLiveRuntimeController({
      agents,
      registry,
      lifecycle,
      eventBus,
      launch,
      scheduler: live.scheduler,
    });
    const app = createApp({
      studioConfig,
      agents,
      eventBus,
      runtimeController,
      onAgentUpdated: (agent) => registry.updateConfig(agent),
    });

    await app.listen({
      host: studioConfig.server.host,
      port: studioConfig.server.port,
    });
    console.log(`Studio backend listening on http://${studioConfig.server.host}:${studioConfig.server.port}`);

    live.start();
    console.log("Live agent runtime started. Use the dashboard launch flow or /aichat <task> in Minecraft to wake the agents.");
    if (autoConnectAgents) {
      await connectAgents(agents, lifecycle, launch);
      console.log("Initial live agent connection pass finished.");
      logAgentConnectionSummary(agents, lifecycle);
    } else {
      console.log("Initial agent auto-connect disabled; waiting for dashboard launch requests.");
    }

    const shutdown = async (): Promise<void> => {
      console.log("Shutting down live agents...");
      await live.stop();
      await Promise.allSettled(
        agents.map((agent) => lifecycle.disconnect(agent.id, "live runtime shutdown")),
      );
      await app.close();
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
  } catch (error) {
    console.error(formatStartupError(error));
    process.exitCode = 1;
  }
}

interface LiveRuntimeControllerOptions {
  agents: AgentConfig[];
  registry: AgentRegistry;
  lifecycle: BotLifecycleManager;
  eventBus: StudioEventBus;
  launch: LiveLaunchOptions;
  scheduler: AgentScheduler;
}

function createLiveRuntimeController(options: LiveRuntimeControllerOptions): RuntimeController {
  async function stopOne(agentId: string, reason?: string): Promise<RuntimeAgentControlResult> {
    try {
      await options.lifecycle.disconnect(agentId, reason ?? "dashboard runtime stop");
      options.scheduler.pauseAgent(agentId);
      const agent = options.agents.find((candidate) => candidate.id === agentId);
      const snapshot = agent ? runtimeSnapshot(agent, options) : undefined;
      if (snapshot) publishAgentState(snapshot, options.eventBus, reason ?? "Stopped from dashboard");
      return {
        agentId,
        ok: true,
        connectionStatus: snapshot?.connectionStatus ?? "disconnected",
        mode: snapshot?.mode ?? "paused",
      };
    } catch (error) {
      return {
        agentId,
        ok: false,
        connectionStatus: "failed",
        mode: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    status() {
      return options.agents.map((agent) => runtimeSnapshot(agent, options));
    },
    async launch(input) {
      const results: RuntimeAgentControlResult[] = [];
      console.log(
        `[live-launch] requested ${input.agentIds.length} agent(s): ${input.agentIds.join(", ")}`,
      );
      for (let index = 0; index < input.agentIds.length; index += options.launch.batchSize) {
        const batch = input.agentIds.slice(index, index + options.launch.batchSize);
        results.push(...await Promise.all(batch.map((agentId) => launchOne(agentId, input))));
        if (index + options.launch.batchSize < input.agentIds.length) {
          await delay(options.launch.batchDelayMs);
        }
      }
      return results;
    },
    stop(agentId, reason) {
      return stopOne(agentId, reason);
    },
    async stopAll(agentIds, reason) {
      const results: RuntimeAgentControlResult[] = [];
      for (const agentId of agentIds) {
        results.push(await stopOne(agentId, reason));
      }
      return results;
    },
    minecraft() {
      return checkMinecraftServer(options.launch);
    },
  };

  async function launchOne(
    agentId: string,
    input: RuntimeLaunchRequest,
  ): Promise<RuntimeAgentControlResult> {
        const agent = options.agents.find((candidate) => candidate.id === agentId);
        if (!agent) {
          return {
            agentId,
            ok: false,
            connectionStatus: "failed",
            mode: "failed",
            error: `unknown agent: ${agentId}`,
          };
        }
        if (agent.enabled === false) {
          return {
            agentId,
            ok: false,
            connectionStatus: "failed",
            mode: "failed",
            error: "agent is disabled",
          };
        }

        const current = options.lifecycle.getStatus(agentId);
        if (current.status === "connected") {
          options.scheduler.resumeAgent(agentId);
          publishAgentState(runtimeSnapshot(agent, options), options.eventBus, "Launch already active");
          return resultFromStatus(agentId, current.status, true);
        }
        if (current.status === "connecting") {
          try {
            const status = await waitForLaunchStatus(agentId, options.lifecycle, options.launch.spawnTimeoutMs);
            options.scheduler.resumeAgent(agentId);
            publishAgentState(runtimeSnapshot(agent, options), options.eventBus, "Launch already active");
            return resultFromStatus(agentId, status, true);
          } catch (error) {
            return failLaunch(agentId, error);
          }
        }

        try {
          console.log(`[live-launch] connecting ${agent.id} as ${agent.account.username}`);
          await options.lifecycle.connect(agentId);
          const status = await waitForLaunchStatus(agentId, options.lifecycle, options.launch.spawnTimeoutMs);
          const snapshot = runtimeSnapshot(agent, options);
          options.scheduler.resumeAgent(agentId);
          publishAgentState(snapshot, options.eventBus, input.scenarioGoal ?? "Dashboard launch requested");
          console.log(`[live-launch] ${agent.id} spawned as ${agent.account.username}`);
          return resultFromStatus(agentId, status, true);
        } catch (error) {
          return failLaunch(agentId, error);
        }

  }

  async function failLaunch(agentId: string, error: unknown): Promise<RuntimeAgentControlResult> {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[live-launch] ${agentId} failed: ${message}`);
    if (options.lifecycle.getStatus(agentId).status === "connecting") {
      await options.lifecycle.disconnect(agentId, "dashboard launch failed before spawn");
    }
    options.scheduler.pauseAgent(agentId);
    options.registry.markError(agentId, message);
    const agent = options.agents.find((candidate) => candidate.id === agentId);
    if (agent) {
      publishAgentState(runtimeSnapshot(agent, options), options.eventBus, message);
    }
    return {
      agentId,
      ok: false,
      connectionStatus: "failed",
      mode: "failed",
      error: message,
    };
  }
}

function runtimeSnapshot(
  agent: AgentConfig,
  options: LiveRuntimeControllerOptions,
): RuntimeAgentSnapshot {
  const lifecycle = options.lifecycle.getStatus(agent.id);
  const registryView = options.registry.get(agent.id);
  const bot = options.registry.getBot(agent.id);
  const connectionStatus = lifecycle.status;
  const position = bot?.entity?.position
    ? {
        x: bot.entity.position.x,
        y: bot.entity.position.y,
        z: bot.entity.position.z,
        world: bot.entity.position.world,
      }
    : undefined;
  return {
    agentId: agent.id,
    mode: registryView?.mode ?? agentModeForConnection(connectionStatus),
    connectionStatus,
    hasBot: registryView?.hasBot ?? false,
    currentTask: agent.routine ?? agent.role,
    lastError: lifecycle.lastError ?? registryView?.lastError,
    position,
    updatedAt: latestIso(lifecycle.updatedAt, registryView?.updatedAt),
  };
}

function resultFromStatus(
  agentId: string,
  connectionStatus: BotConnectionStatus,
  ok: boolean,
): RuntimeAgentControlResult {
  return {
    agentId,
    ok,
    connectionStatus,
    mode: agentModeForConnection(connectionStatus),
  };
}

function publishAgentState(
  snapshot: RuntimeAgentSnapshot,
  eventBus: StudioEventBus,
  currentTask: string,
): void {
  eventBus.emit("agent.state", {
    agentId: snapshot.agentId,
    mode: snapshot.mode,
    currentTask,
    health: compactJson({
      connectionStatus: snapshot.connectionStatus,
      hasBot: snapshot.hasBot,
      lastError: snapshot.lastError,
      position: snapshot.position,
    }),
    updatedAt: snapshot.updatedAt,
  });
}

async function checkMinecraftServer(options: LiveLaunchOptions): Promise<RuntimeServiceSnapshot> {
  const checkedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const socket = connectSocket({ host: options.host, port: options.port });
    const finish = (snapshot: RuntimeServiceSnapshot): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ ...snapshot, host: options.host, port: options.port, checkedAt });
    };
    socket.setTimeout(750);
    socket.once("connect", () => finish({ status: "online", message: "Minecraft TCP port accepted a connection" }));
    socket.once("timeout", () => finish({ status: "degraded", message: "Minecraft TCP readiness timed out" }));
    socket.once("error", (error) => finish({ status: "offline", message: error.message }));
  });
}

function logAgentConnectionSummary(
  agents: Awaited<ReturnType<typeof loadAgentConfigs>>,
  lifecycle: BotLifecycleManager,
): void {
  const statuses = agents.map((agent) => lifecycle.getStatus(agent.id));
  const connected = statuses.filter((status) => status.status === "connected").length;
  const connecting = statuses.filter((status) => status.status === "connecting").length;
  const failed = statuses.filter((status) => status.status === "failed").length;
  const disconnected = statuses.filter((status) => status.status === "disconnected").length;
  console.log(
    `Live agent connection summary: ${connected} connected, ${connecting} connecting, `
      + `${failed} failed, ${disconnected} disconnected.`,
  );
  for (const status of statuses.filter((item) => item.status === "failed")) {
    console.warn(`[live-bot] ${status.agentId} failed: ${status.lastError ?? "unknown"}`);
  }
}

async function connectAgents(
  agents: Awaited<ReturnType<typeof loadAgentConfigs>>,
  lifecycle: BotLifecycleManager,
  options: LiveLaunchOptions,
): Promise<void> {
  console.log(
    `Connecting ${agents.length} agents to ${options.host}:${options.port}`
      + `${options.version ? ` (${options.version})` : ""}`
      + ` in batches of ${options.batchSize}.`,
  );

  for (let index = 0; index < agents.length; index += options.batchSize) {
    const batch = agents.slice(index, index + options.batchSize);
    const batchNumber = Math.floor(index / options.batchSize) + 1;
    const batchCount = Math.ceil(agents.length / options.batchSize);
    console.log(`Connecting agent batch ${batchNumber}/${batchCount}: ${batch.map((agent) => agent.id).join(", ")}`);
    const results = await Promise.allSettled(batch.map((agent) => lifecycle.connect(agent.id)));
    const fulfilled = results.filter((result) => result.status === "fulfilled").length;
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const agent = batch[resultIndex];
      const result = results[resultIndex];
      if (result.status === "fulfilled") {
        console.log(`started ${agent.id} as ${agent.account.username}`);
      } else {
        console.error(`failed to start ${agent.id}: ${formatError(result.reason)}`);
      }
    }
    console.log(`Agent batch ${batchNumber}/${batchCount} finished: ${fulfilled}/${batch.length} connected.`);
    if (index + options.batchSize < agents.length) {
      await delay(options.batchDelayMs);
    }
  }
}

function readLaunchOptions(): LiveLaunchOptions {
  return {
    host: process.env.MC_SERVER_HOST ?? "127.0.0.1",
    port: readIntegerEnv("MC_SERVER_PORT", 25565, 1, 65_535),
    version: process.env.MC_SERVER_VERSION,
    batchSize: readIntegerEnv("MC_AGENT_BATCH_SIZE", 5, 1, 20),
    batchDelayMs: readIntegerEnv("MC_AGENT_BATCH_DELAY_MS", 2_000, 0, 60_000),
    spawnTimeoutMs: readIntegerEnv("MC_AGENT_SPAWN_TIMEOUT_MS", 20_000, 1_000, 120_000),
  };
}

function shouldAutoConnectAgents(): boolean {
  const value = process.env.MC_AUTO_CONNECT_AGENTS;
  if (value === undefined) {
    return false;
  }
  return ["1", "true", "on", "yes"].includes(value.toLowerCase());
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function latestIso(left: string, right: string | undefined): string {
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function compactJson(source: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

async function waitForLaunchStatus(
  agentId: string,
  lifecycle: BotLifecycleManager,
  timeoutMs: number,
): Promise<"connected"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = lifecycle.getStatus(agentId);
    if (status.status === "connected") {
      return "connected";
    }
    if (status.status === "failed") {
      throw new Error(status.lastError ?? "bot failed before spawn");
    }
    await delay(100);
  }

  throw new Error(`timed out waiting for ${agentId} to spawn after ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warnIfProviderEnvMissing(agents: Awaited<ReturnType<typeof loadAgentConfigs>>): void {
  if (agents.some((agent) => agent.providerRef === "deepseek") && !process.env.DEEPSEEK_API_KEY) {
    console.warn(
      "DEEPSEEK_API_KEY is not set in this terminal. Live planning will fall back instead of calling DeepSeek.",
    );
  }
}

void main();
