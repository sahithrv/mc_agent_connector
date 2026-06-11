import type { AgentConfig } from "@mc-ai-video/contracts";

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

      return options.createBot(createOptions);
    },
  };
}
