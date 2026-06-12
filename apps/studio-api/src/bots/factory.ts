import type { AgentConfig } from "@mc-ai-video/contracts";
import { Movements, pathfinder } from "mineflayer-pathfinder";

const collectBlockPlugin = require("mineflayer-collectblock").plugin as (bot: unknown) => void;

import type {
  BotFactory,
  BotHandle,
  LocalServerConnection,
  MineflayerCreateBot,
  MineflayerCreateBotOptions,
} from "./types";

export interface MineflayerBotFactoryOptions {
  server: LocalServerConnection;
  createBot: MineflayerCreateBot;
}

export function createMineflayerBotFactory(
  options: MineflayerBotFactoryOptions,
): BotFactory {
  return {
    async connect(config: AgentConfig): Promise<BotHandle> {
      const createOptions: MineflayerCreateBotOptions = {
        host: options.server.host,
        port: options.server.port,
        username: config.account.username,
        auth: config.account.auth ?? "offline",
        version: options.server.version,
      };

      const bot = options.createBot(createOptions);
      bot.loadPlugin?.(pathfinder as unknown as (bot: unknown) => void);
      bot.loadPlugin?.(collectBlockPlugin);
      bot.on("spawn", () => {
        if (bot.pathfinder?.setMovements) {
          bot.pathfinder.setMovements(new Movements(bot as never));
        }
      });
      return bot;
    },
  };
}
