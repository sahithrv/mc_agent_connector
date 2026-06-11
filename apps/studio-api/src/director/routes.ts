import { randomUUID } from "node:crypto";

import type { AgentConfig, JsonValue } from "@mc-ai-video/contracts";
import type { FastifyInstance } from "fastify";

import { AiChatService } from "../chat/service";
import type { ClipMarkersRepository, EventsRepository } from "../db";
import type { StudioEventBus } from "../events/bus";
import { gameEventFromBody } from "../events/factory";
import type { DirectorCommand } from "../events/types";
import {
  objectBody,
  optionalString,
  requiredString,
  validationResponse,
} from "../http/validation";

export interface DirectorRoutesOptions {
  agents: AgentConfig[];
  chat: AiChatService;
  events: StudioEventBus;
  eventsRepository?: EventsRepository;
  clipMarkers?: ClipMarkersRepository;
  sessionId?: string;
}

export function registerDirectorRoutes(app: FastifyInstance, options: DirectorRoutesOptions): void {
  app.post("/director/agents/:agentId/pause", (request, reply) => {
    try {
      const params = objectBody(request.params, "params");
      const meta = optionalCommandMeta(request.body);
      const command = emitCommand(options.events, {
        type: "pause-agent",
        targetAgentId: requiredString(params, "agentId", 128),
        ...meta,
      });
      return { ok: true, command };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/agents/:agentId/resume", (request, reply) => {
    try {
      const params = objectBody(request.params, "params");
      const meta = optionalCommandMeta(request.body);
      const command = emitCommand(options.events, {
        type: "resume-agent",
        targetAgentId: requiredString(params, "agentId", 128),
        ...meta,
      });
      return { ok: true, command };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/agents/pause-all", (request, reply) => {
    try {
      const meta = optionalCommandMeta(request.body);
      const command = emitCommand(options.events, {
        type: "pause-all",
        payload: { agentIds: options.agents.map((agent) => agent.id) },
        ...meta,
      });
      return { ok: true, command };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/agents/resume-all", (request, reply) => {
    try {
      const meta = optionalCommandMeta(request.body);
      const command = emitCommand(options.events, {
        type: "resume-all",
        payload: { agentIds: options.agents.map((agent) => agent.id) },
        ...meta,
      });
      return { ok: true, command };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/events", (request, reply) => {
    try {
      const event = gameEventFromBody(request.body);
      if (options.eventsRepository) {
        options.eventsRepository.insert({
          id: event.id,
          sessionId: requireSessionId(options),
          type: event.type,
          actorId: event.actorId,
          targetId: event.targetId,
          location: event.location,
          severity: event.severity,
          payload: event.payload,
          timestamp: event.timestamp,
        });
      }
      options.events.emit("game.event", event);
      emitCommand(options.events, {
        type: "inject-event",
        payload: { eventId: event.id, eventType: event.type },
      });
      return reply.status(201).send({ ok: true, event });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/chat", async (request, reply) => {
    try {
      const message = await options.chat.sendFromBody(request.body);
      emitCommand(options.events, {
        type: "send-ai-chat",
        requestedBy: message.senderId,
        payload: { messageId: message.id },
      });
      return reply.status(201).send({ ok: true, message });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/clips", (request, reply) => {
    try {
      const source = objectBody(request.body);
      const label = optionalString(source, "title", 128) ?? requiredString(source, "label", 128);
      const timestamp = optionalString(source, "timestamp", 64) ?? new Date().toISOString();
      const marker = options.clipMarkers?.create({
        sessionId: requireSessionId(options),
        title: label,
        notes: optionalString(source, "notes", 1024),
        sourceEventId: optionalString(source, "eventId", 128),
        timestamp,
      });
      const command = emitCommand(options.events, {
        type: "mark-clip",
        requestedBy: optionalString(source, "requestedBy", 128),
        payload: compactJson({
          markerId: marker?.id,
          label,
          eventId: optionalString(source, "eventId", 128),
          notes: optionalString(source, "notes", 1024),
          timestamp,
        }),
      });
      return reply.status(201).send({ ok: true, marker, command });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });
}

function requireSessionId(options: DirectorRoutesOptions): string {
  if (!options.sessionId) {
    throw new Error("director persistence requires a current session");
  }
  return options.sessionId;
}

interface CommandInput {
  type: DirectorCommand["type"];
  requestedBy?: string;
  targetAgentId?: string;
  reason?: string;
  payload?: Record<string, JsonValue>;
}

function optionalCommandMeta(body: unknown): Pick<CommandInput, "requestedBy" | "reason" | "payload"> {
  const source = body === undefined ? {} : objectBody(body);
  return {
    requestedBy: optionalString(source, "requestedBy", 128),
    reason: optionalString(source, "reason", 512),
    payload: compactJson({
      reason: optionalString(source, "reason", 512),
    }),
  };
}

function emitCommand(events: StudioEventBus, input: CommandInput): DirectorCommand {
  const command: DirectorCommand = {
    id: randomUUID(),
    type: input.type,
    requestedBy: input.requestedBy,
    targetAgentId: input.targetAgentId,
    reason: input.reason,
    payload: input.payload ?? {},
    timestamp: new Date().toISOString(),
  };
  events.emit("director.command", command);
  return command;
}

function compactJson(source: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}
