import { createBot } from "mineflayer";

import { AgentRegistry } from "../agents/registry";
import { loadAgentConfigs } from "../config/agents";
import { formatStartupError } from "../config/errors";
import { createMineflayerBotFactory } from "./factory";
import { BotLifecycleManager } from "./lifecycle";
import type { BotEventHandler, BotHandle, BotLifecycleEvent, MineflayerCreateBot } from "./types";

interface LaunchOptions {
  host: string;
  port: number;
  version?: string;
  batchSize: number;
  batchDelayMs: number;
  spawnTimeoutMs: number;
  holdMs?: number;
}

export async function main(): Promise<void> {
  try {
    const options = readLaunchOptions();
    const agents = await loadAgentConfigs();
    const registry = new AgentRegistry(agents);
    const lifecycle = new BotLifecycleManager(
      registry,
      createMineflayerBotFactory({
        server: {
          host: options.host,
          port: options.port,
          version: options.version,
        },
        createBot: createBot as unknown as MineflayerCreateBot,
      }),
    );

    console.log(
      `Connecting ${agents.length} agents to ${options.host}:${options.port}`
      + `${options.version ? ` (${options.version})` : ""}`
      + ` in batches of ${options.batchSize}.`,
    );

    const shutdown = async (): Promise<void> => {
      console.log("Disconnecting agents...");
      await Promise.allSettled(
        agents.map((agent) => lifecycle.disconnect(agent.id, "studio shutdown")),
      );
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());

    for (let index = 0; index < agents.length; index += options.batchSize) {
      const batch = agents.slice(index, index + options.batchSize);
      const results = await Promise.allSettled(
        batch.map(async (agent) => {
          const bot = await lifecycle.connect(agent.id);
          await waitForSpawn(agent.id, bot, options.spawnTimeoutMs);
          console.log(`connected ${agent.id} as ${agent.account.username}`);
        }),
      );

      for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
        const result = results[resultIndex];
        if (result.status === "rejected") {
          const agent = batch[resultIndex];
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error(`failed to start ${agent.id}: ${reason}`);
        }
      }

      if (index + options.batchSize < agents.length) {
        await delay(options.batchDelayMs);
      }
    }

    if (options.holdMs !== undefined) {
      console.log(`Launch attempt finished. Holding for ${options.holdMs}ms before disconnect.`);
      await delay(options.holdMs);
      await shutdown();
      return;
    }

    console.log("Launch requested for all agents. Keep this process running to keep bots connected.");
    setInterval(() => {
      const snapshots = agents.map((agent) => lifecycle.getStatus(agent.id));
      const connected = snapshots.filter((snapshot) => snapshot.status === "connected").length;
      const connecting = snapshots.filter((snapshot) => snapshot.status === "connecting").length;
      const failed = snapshots.filter((snapshot) => snapshot.status === "failed").length;
      console.log(`agent status: ${connected} connected, ${connecting} connecting, ${failed} failed`);
    }, 10_000);
  } catch (error) {
    console.error(formatStartupError(error));
    process.exitCode = 1;
  }
}

function readLaunchOptions(): LaunchOptions {
  return {
    host: process.env.MC_SERVER_HOST ?? "127.0.0.1",
    port: readIntegerEnv("MC_SERVER_PORT", 25565, 1, 65_535),
    version: process.env.MC_SERVER_VERSION,
    batchSize: readIntegerEnv("MC_AGENT_BATCH_SIZE", 5, 1, 20),
    batchDelayMs: readIntegerEnv("MC_AGENT_BATCH_DELAY_MS", 2_000, 0, 60_000),
    spawnTimeoutMs: readIntegerEnv("MC_AGENT_SPAWN_TIMEOUT_MS", 30_000, 1_000, 120_000),
    holdMs: process.env.MC_AGENT_HOLD_MS === undefined
      ? undefined
      : readIntegerEnv("MC_AGENT_HOLD_MS", 0, 0, 86_400_000),
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

function waitForSpawn(agentId: string, bot: BotHandle, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      remove("spawn", onSpawn);
      remove("kicked", onKicked);
      remove("error", onError);
      remove("end", onEnd);
    };
    const finish = (error?: Error): void => {
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const remove = (event: BotLifecycleEvent, handler: BotEventHandler): void => {
      if (bot.off) {
        bot.off(event, handler);
      } else {
        bot.removeListener?.(event, handler);
      }
    };

    const onSpawn = (): void => finish();
    const onKicked = (reason?: unknown): void => finish(new Error(`kicked: ${formatUnknown(reason)}`));
    const onError = (error?: unknown): void => finish(new Error(`bot error: ${formatUnknown(error)}`));
    const onEnd = (): void => finish(new Error("bot ended before spawn"));
    const timeout = setTimeout(() => {
      finish(new Error(`timed out waiting for ${agentId} to spawn after ${timeoutMs}ms`));
    }, timeoutMs);

    bot.on("spawn", onSpawn);
    bot.on("kicked", onKicked);
    bot.on("error", onError);
    bot.on("end", onEnd);
  });
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

void main();
