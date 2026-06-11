import { timingSafeEqual } from "node:crypto";

import { PLUGIN_SHARED_SECRET_HEADER } from "@mc-ai-video/contracts";
import type { FastifyInstance } from "fastify";

import type { EventsRepository } from "../db";
import type { StudioEventBus } from "../events/bus";
import { gameEventFromBody } from "../events/factory";
import { validationResponse } from "./validation";

export interface PluginEventRoutesOptions {
  events: StudioEventBus;
  eventsRepository?: EventsRepository;
  sessionId?: string;
  sharedSecret?: string;
}

export function registerPluginEventRoutes(
  app: FastifyInstance,
  options: PluginEventRoutesOptions,
): void {
  app.post("/plugin/events", (request, reply) => {
    if (!options.sharedSecret) {
      return reply.status(503).send({ error: "plugin shared secret is not configured" });
    }
    if (!hasValidSecret(request.headers, options.sharedSecret)) {
      return reply.status(401).send({ error: "missing or invalid plugin shared secret" });
    }

    try {
      const event = gameEventFromBody(request.body);
      if (options.eventsRepository) {
        if (!options.sessionId) {
          throw new Error("plugin event persistence requires a current session");
        }
        options.eventsRepository.insert({
          id: event.id,
          sessionId: options.sessionId,
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
      return reply.status(202).send({ ok: true, event });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });
}

function hasValidSecret(headers: Record<string, unknown>, expected: string): boolean {
  const candidate =
    headerValue(headers[PLUGIN_SHARED_SECRET_HEADER]) ??
    headerValue(headers["x-studio-plugin-secret"]) ??
    headerValue(headers["x-plugin-secret"]) ??
    bearerToken(headerValue(headers.authorization));

  if (!candidate) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function bearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  return value.slice("Bearer ".length);
}
