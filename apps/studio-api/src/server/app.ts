import Fastify, { type FastifyInstance } from "fastify";

import type { AgentConfig } from "@mc-ai-video/contracts";

import { InMemoryAiChatRepository } from "../chat/repository";
import { registerChatRoutes } from "../chat/routes";
import { AiChatService } from "../chat/service";
import { SqliteAiChatRepository } from "../chat/sqlite-repository";
import type { AiChatRepository } from "../chat/types";
import type { StudioConfig } from "../config/studio";
import { createStudioPersistence, type StudioPersistence } from "../db/runtime";
import { registerDirectorRoutes } from "../director/routes";
import { StudioEventBus } from "../events/bus";
import { registerHealthRoutes } from "../http/health";
import { registerPluginEventRoutes } from "../http/plugin-events";
import { registerDashboardWs } from "../ws/hub";

export interface CreateAppOptions {
  studioConfig: StudioConfig;
  agents: AgentConfig[];
  eventBus?: StudioEventBus;
  chatRepository?: AiChatRepository;
  persistence?: StudioPersistence | false;
  pluginSharedSecret?: string;
}

export function createApp(options: CreateAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.studioConfig.server.logger
      ? { level: process.env.LOG_LEVEL ?? "info" }
      : false,
  });
  const eventBus = options.eventBus ?? new StudioEventBus();
  let ownedPersistence: StudioPersistence | undefined;
  const persistence = options.persistence === false
    ? undefined
    : options.persistence ?? (ownedPersistence = createStudioPersistence(options.studioConfig.database.path));
  const chatRepository = options.chatRepository
    ?? (persistence
      ? new SqliteAiChatRepository(persistence.chatMessages, persistence.session.id)
      : new InMemoryAiChatRepository());
  const chat = new AiChatService(chatRepository, eventBus);

  if (ownedPersistence) {
    app.addHook("onClose", (_instance, done) => {
      ownedPersistence?.db.close();
      done();
    });
  }

  app.decorate("studio", {
    config: options.studioConfig,
    agents: options.agents,
    eventBus,
    chat,
  });

  registerHealthRoutes(app);
  registerChatRoutes(app, chat);
  registerDirectorRoutes(app, {
    agents: options.agents,
    chat,
    events: eventBus,
    eventsRepository: persistence?.events,
    clipMarkers: persistence?.clipMarkers,
    sessionId: persistence?.session.id,
  });
  registerPluginEventRoutes(app, {
    events: eventBus,
    eventsRepository: persistence?.events,
    sessionId: persistence?.session.id,
    sharedSecret: options.pluginSharedSecret
      ?? process.env.MCAS_PLUGIN_SHARED_SECRET
      ?? process.env.STUDIO_PLUGIN_SHARED_SECRET,
  });
  registerDashboardWs(app, { events: eventBus });
  return app;
}
