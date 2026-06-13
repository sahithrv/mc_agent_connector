import type {
  AgentConfig,
  BotConnectionStatus,
  RuntimeAgentControlResult,
  RuntimeAgentSnapshot,
  RuntimeLaunchRequest,
  RuntimeServiceSnapshot,
  RuntimeStatusSnapshot,
} from "@mc-ai-video/contracts";
import type { FastifyInstance } from "fastify";

import type { StudioEventBus } from "../events/bus";
import {
  objectBody,
  optionalString,
  RequestValidationError,
  requiredString,
  requiredStringArray,
  validationResponse,
} from "../http/validation";

export interface RuntimeController {
  status(): Promise<RuntimeAgentSnapshot[]> | RuntimeAgentSnapshot[];
  launch(input: RuntimeLaunchRequest): Promise<RuntimeAgentControlResult[]>;
  stop(agentId: string, reason?: string): Promise<RuntimeAgentControlResult>;
  stopAll?(agentIds: string[], reason?: string): Promise<RuntimeAgentControlResult[]>;
  minecraft?(): Promise<RuntimeServiceSnapshot> | RuntimeServiceSnapshot;
}

export interface RuntimeRoutesOptions {
  agents: AgentConfig[];
  events: StudioEventBus;
  controller?: RuntimeController;
}

export function registerRuntimeRoutes(app: FastifyInstance, options: RuntimeRoutesOptions): void {
  app.get("/runtime/status", async (): Promise<RuntimeStatusSnapshot> => ({
    ok: true,
    capabilities: {
      launch: Boolean(options.controller),
      stop: Boolean(options.controller),
      restart: false,
    },
    minecraft: options.controller?.minecraft
      ? await options.controller.minecraft()
      : {
          status: "unknown",
          message: "Live runtime controller is not attached to this API process",
          checkedAt: new Date().toISOString(),
        },
    agents: options.controller
      ? await options.controller.status()
      : options.agents.map(disconnectedAgentSnapshot),
  }));

  app.post("/runtime/launch", async (request, reply) => {
    if (!options.controller) {
      return reply.status(501).send({
        error: "live runtime launch is unavailable; start the live-agents backend to connect bots",
      });
    }

    try {
      const body = objectBody(request.body);
      const input: RuntimeLaunchRequest = {
        agentIds: requiredStringArray(body, "agentIds", options.agents.length),
        scenarioGoal: optionalString(body, "scenarioGoal", 4_000),
        requestedBy: optionalString(body, "requestedBy", 128) ?? "studio-web",
      };
      assertKnownEnabledAgents(options.agents, input.agentIds);
      publishScenarioGoal(options.events, input);
      const results = await options.controller.launch(input);
      return { ok: results.every((result) => result.ok), results };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/runtime/agents/:agentId/stop", async (request, reply) => {
    if (!options.controller) {
      return reply.status(501).send({
        error: "live runtime stop is unavailable; start the live-agents backend to control bots",
      });
    }

    try {
      const params = objectBody(request.params, "params");
      const body = request.body === undefined ? {} : objectBody(request.body);
      const agentId = requiredString(params, "agentId", 128);
      assertKnownAgents(options.agents, [agentId]);
      const result = await options.controller.stop(agentId, optionalString(body, "reason", 512));
      return { ok: result.ok, results: [result] };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });

  app.post("/runtime/agents/stop-all", async (request, reply) => {
    if (!options.controller) {
      return reply.status(501).send({
        error: "live runtime stop is unavailable; start the live-agents backend to control bots",
      });
    }

    try {
      const body = request.body === undefined ? {} : objectBody(request.body);
      const agentIds = optionalStringArray(body, "agentIds") ?? options.agents.map((agent) => agent.id);
      assertKnownAgents(options.agents, agentIds);
      const reason = optionalString(body, "reason", 512);
      const results = options.controller.stopAll
        ? await options.controller.stopAll(agentIds, reason)
        : await Promise.all(agentIds.map((agentId) => options.controller!.stop(agentId, reason)));
      return { ok: results.every((result) => result.ok), results };
    } catch (error) {
      const response = validationResponse(error);
      return reply.status(response.statusCode).send(response.body);
    }
  });
}

function disconnectedAgentSnapshot(agent: AgentConfig): RuntimeAgentSnapshot {
  return {
    agentId: agent.id,
    mode: agent.mode ?? "paused",
    connectionStatus: "disconnected",
    hasBot: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function publishScenarioGoal(events: StudioEventBus, input: RuntimeLaunchRequest): void {
  const goal = input.scenarioGoal?.trim();
  if (!goal) return;

  events.emit("game.event", {
    id: `scenario-${Date.now()}`,
    type: "chat.leader_command",
    actorId: input.requestedBy ?? "studio-web",
    severity: 4,
    visibility: "ai",
    payload: {
      content: goal,
      agentIds: input.agentIds,
      source: "runtime.launch",
    },
    timestamp: new Date().toISOString(),
  });
}

function assertKnownEnabledAgents(agents: AgentConfig[], agentIds: string[]): void {
  assertKnownAgents(agents, agentIds);
  const disabled = agents.find((agent) => agentIds.includes(agent.id) && agent.enabled === false);
  if (disabled) {
    throw new RequestValidationError(`agent is disabled: ${disabled.id}`);
  }
}

function assertKnownAgents(agents: AgentConfig[], agentIds: string[]): void {
  const known = new Set(agents.map((agent) => agent.id));
  const unknown = agentIds.find((agentId) => !known.has(agentId));
  if (unknown) {
    throw new RequestValidationError(`unknown agent: ${unknown}`);
  }
}

function optionalStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  if (source[key] === undefined) return undefined;
  return requiredStringArray(source, key);
}

export function agentModeForConnection(status: BotConnectionStatus): RuntimeAgentSnapshot["mode"] {
  if (status === "failed") return "failed";
  if (status === "connected" || status === "connecting") return "routine";
  return "paused";
}
