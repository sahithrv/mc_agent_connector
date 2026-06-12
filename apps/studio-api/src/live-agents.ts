import { createBot } from "mineflayer";

import { AgentRegistry } from "./agents/registry";
import { createMineflayerBotFactory } from "./bots/factory";
import { BotLifecycleManager } from "./bots/lifecycle";
import type { MineflayerCreateBot } from "./bots/types";
import { loadAgentConfigs } from "./config/agents";
import { formatStartupError } from "./config/errors";
import { loadStudioConfig } from "./config/studio";
import { StudioEventBus } from "./events/bus";
import { createLiveAgentRuntime } from "./live/runtime";
import { createApp } from "./server/app";

interface LiveLaunchOptions {
  host: string;
  port: number;
  version?: string;
  batchSize: number;
  batchDelayMs: number;
}

export async function main(): Promise<void> {
  try {
    const launch = readLaunchOptions();
    const studioConfig = await loadStudioConfig();
    const agents = await loadAgentConfigs();
    warnIfProviderEnvMissing(agents);
    const eventBus = new StudioEventBus();
    const registry = new AgentRegistry(agents);
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
    const app = createApp({ studioConfig, agents, eventBus });
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

    await app.listen({
      host: studioConfig.server.host,
      port: studioConfig.server.port,
    });
    console.log(`Studio backend listening on http://${studioConfig.server.host}:${studioConfig.server.port}`);

    live.start();
    console.log("Live agent runtime started. Use /aichat <task> in Minecraft to wake the agents.");
    await connectAgents(agents, lifecycle, launch);
    console.log("Initial live agent connection pass finished.");
    logAgentConnectionSummary(agents, lifecycle);

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
  };
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
