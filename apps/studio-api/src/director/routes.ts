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
  RequestValidationError,
  requiredString,
  validationResponse,
} from "../http/validation";

const INJECTION_KINDS = [
  "personality",
  "role",
  "task",
  "team-task",
  "god-dialogue",
  "memory",
  "trait",
  "instruction",
] as const;
const INJECTION_SCOPES = ["agent", "subteam", "all"] as const;
const DEFAULT_AGENT_ACTIONS = [
  "idle",
  "continue_routine",
  "move_to",
  "follow_player",
  "flee",
  "mine_block",
  "collect_item",
  "place_block",
  "attack_entity",
  "chat_public",
  "chat_ai_private",
] as const;

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

  app.post("/director/injections", (request, reply) => {
    try {
      const source = objectBody(request.body);
      const kind = requiredEnum(source, "kind", INJECTION_KINDS);
      const scope = requiredEnum(source, "scope", INJECTION_SCOPES);
      const text = requiredString(source, "text", 4_000).trim();
      const taskId = optionalString(source, "taskId", 128);
      const targetAgentId = scope === "agent"
        ? requiredString(source, "agentId", 128)
        : optionalString(source, "agentId", 128);
      const subteamId = scope === "subteam"
        ? requiredString(source, "subteamId", 128)
        : optionalString(source, "subteamId", 128);
      const meta = optionalCommandMeta(source);

      const commandType = commandTypeForInjection(kind, scope);
      const command = emitCommand(options.events, {
        type: commandType,
        requestedBy: meta.requestedBy ?? "director",
        targetAgentId,
        reason: optionalString(source, "reason", 512),
        payload: compactJson({
          kind,
          scope,
          text,
          content: text,
          role: kind === "role" ? text : undefined,
          task: kind === "task" || kind === "team-task" ? text : undefined,
          taskId,
          agentId: targetAgentId,
          subteamId,
          secret: booleanValue(source.secret),
        }),
      });
      return reply.status(201).send({ ok: true, command });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/subteams/:subteamId/task", (request, reply) => {
    try {
      const params = objectBody(request.params, "params");
      const source = objectBody(request.body);
      const subteamId = requiredString(params, "subteamId", 128);
      const task = requiredString(source, "task", 4_000).trim();
      const command = emitCommand(options.events, {
        type: "set-subteam-task",
        requestedBy: optionalString(source, "requestedBy", 128) ?? "director",
        reason: optionalString(source, "reason", 512),
        payload: compactJson({
          subteamId,
          task,
          taskId: optionalString(source, "taskId", 128),
        }),
      });
      return reply.status(201).send({ ok: true, command });
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/director/agents", (request, reply) => {
    try {
      const agent = agentConfigFromBody(request.body);
      if (options.agents.some((existing) => existing.id === agent.id)) {
        return reply.status(409).send({ error: `agent already exists: ${agent.id}` });
      }
      if (options.agents.some((existing) => existing.account.username === agent.account.username)) {
        return reply.status(409).send({ error: `agent username already exists: ${agent.account.username}` });
      }

      options.agents.push(agent);
      const command = emitCommand(options.events, {
        type: "add-agent",
        requestedBy: "director",
        targetAgentId: agent.id,
        payload: { agent: agentConfigJson(agent) },
      });
      return reply.status(201).send({ ok: true, agent, command });
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

function commandTypeForInjection(
  kind: (typeof INJECTION_KINDS)[number],
  scope: (typeof INJECTION_SCOPES)[number],
): DirectorCommand["type"] {
  if (kind === "god-dialogue") return "god-dialogue";
  if (kind === "role" && scope === "agent") return "set-agent-role";
  if (kind === "task" && scope === "agent") return "set-agent-task";
  if ((kind === "task" || kind === "team-task") && scope === "subteam") return "set-subteam-task";
  return "inject-agent-context";
}

function agentConfigFromBody(body: unknown): AgentConfig {
  const source = objectBody(body);
  const account = objectBody(source.account, "account");
  const allowedActions = stringArrayValue(source.allowedActions) ?? [...DEFAULT_AGENT_ACTIONS];
  return {
    id: requiredString(source, "id", 128),
    name: requiredString(source, "name", 128),
    account: {
      username: requiredString(account, "username", 16),
      auth: account.auth === "microsoft" ? "microsoft" : "offline",
    },
    role: requiredString(source, "role", 128),
    team: optionalString(source, "team", 128),
    subteam: optionalString(source, "subteam", 128),
    leader: booleanValue(source.leader),
    mode: "routine",
    routine: optionalString(source, "routine", 128),
    allowedActions,
    providerRef: optionalString(source, "providerRef", 128) ?? "deepseek",
    visibility: "ai",
  };
}

function agentConfigJson(agent: AgentConfig): Record<string, JsonValue> {
  return compactJson({
    id: agent.id,
    name: agent.name,
    account: compactJson({
      username: agent.account.username,
      auth: agent.account.auth,
    }),
    role: agent.role,
    team: agent.team,
    subteam: agent.subteam,
    leader: agent.leader,
    mode: agent.mode,
    routine: agent.routine,
    allowedActions: agent.allowedActions,
    providerRef: agent.providerRef,
    visibility: agent.visibility,
  });
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestValidationError("allowedActions must be a non-empty string array");
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new RequestValidationError("allowedActions must contain only non-empty strings");
    }
    return item.trim();
  });
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requiredEnum<T extends readonly string[]>(
  source: Record<string, unknown>,
  key: string,
  values: T,
): T[number] {
  const value = source[key];
  if (typeof value !== "string" || !values.includes(value)) {
    throw new RequestValidationError(`${key} must be one of: ${values.join(", ")}`);
  }
  return value;
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
