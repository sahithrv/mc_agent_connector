import { randomUUID } from "node:crypto";

import type {
  ActionRequest,
  ActionResult,
  AgentConfig,
  AiChatMessage,
  EventSeverity,
  GameEvent,
  JsonValue,
  PerceptionSnapshot as BotPerceptionSnapshot,
  Position,
} from "@mc-ai-video/contracts";

import type { AgentRegistry } from "../agents/registry";
import { DEFAULT_AGENT_ACTIONS, normalizeAgentActions } from "../agents/default-actions";
import { createDefaultActionRegistry } from "../actions";
import type { ActionPolicy, AiChatPublishInput } from "../actions/types";
import type { ActionRegistry as RuntimeActionRegistry } from "../actions/registry";
import { createPerceptionSnapshot } from "../bots/perception";
import type { BotBlock, BotEntity, BotHandle } from "../bots/types";
import {
  BlueprintRegistry,
  CompetitiveTeamOrchestrator,
  LLMRequestQueue,
  LLMResponseSchema,
  TeamMemory,
  type TeamMemorySnapshot,
} from "../competitive";
import { recipeKnowledgeMemories } from "../crafting/knowledge";
import type { StudioEventBus } from "../events/bus";
import { AgentDecisionService, type AgentDecisionServiceResult } from "../llm/decisions/service";
import { allowedDecisionActionsForAgent } from "../llm/decisions/intent-map";
import { createDefaultLlmProviderRegistry, type LlmProviderRegistry } from "../llm/providers";
import type { AgentDecision } from "../llm/schemas/agent-decision";
import type { PromptPerceptionSnapshot, StaticPersona } from "../llm/prompts";
import type {
  PerceptionSnapshot as RoutinePerceptionSnapshot,
  Routine,
  RoutineActionIntent,
} from "../routines";
import { defaultRoutines } from "../routines";
import { AgentScheduler } from "../scheduler/scheduler";
import type {
  ActionRegistry as SchedulerActionRegistry,
  DecisionPlanner,
  PerceptionProvider,
  SchedulerEvent,
  WakeReason,
} from "../scheduler/types";
import { SubteamDirectory, jsonRecipientRequest } from "./subteams";
import { TeamMemoryStore, teamMemoryPromptMemories } from "./team-memory";
import { TeamGoalController } from "./team-goal-controller";

const MAX_RECENT_EVENTS = 50;
const MAX_RECENT_CHAT = 30;
const DEFAULT_MODEL = "deepseek-chat";
const MAX_AUTONOMOUS_COLLECT_DISTANCE = 12;
const USEFUL_DROP_PATTERN =
  /seed|wheat|carrot|potato|apple|bread|beef|pork|chicken|mutton|log|wood|planks|stick|cobblestone|stone|ore|ingot|coal|torch|tool|sword|pickaxe|axe|shovel|hoe/i;
export interface LiveAgentRuntimeOptions {
  agents: AgentConfig[];
  registry: AgentRegistry;
  eventBus: StudioEventBus;
  tickMs: number;
  maxConcurrentActions: number;
  maxPlanningSlots: number;
  planningCooldownMs: number;
  connectAgent?: (agent: AgentConfig) => Promise<void>;
}

export interface LiveAgentRuntime {
  start(): void;
  stop(): Promise<void>;
  scheduler: AgentScheduler;
  competitive: LiveCompetitiveRuntime;
}

export interface LiveCompetitiveRuntime {
  snapshot(teamId: string): TeamMemorySnapshot | undefined;
  snapshots(): TeamMemorySnapshot[];
}

export function createLiveAgentRuntime(options: LiveAgentRuntimeOptions): LiveAgentRuntime {
  const subteams = new SubteamDirectory(options.agents);
  const context = new LiveContext(subteams, options.agents);
  const teamMemory = new TeamMemoryStore({ subteams });
  const coordination = new RuntimeCoordinationMessages(options.eventBus, subteams);
  const llmProviders = createDefaultLlmProviderRegistry();
  const competitive = new CompetitiveLiveCoordinator({
    agents: options.agents,
    subteams,
    registry: options.registry,
    providers: llmProviders,
  });
  const teamGoals = new TeamGoalController({
    subteams,
    getBot: (agentId) => options.registry.getBot(agentId),
    roleForAgent: (agentId) => context.roleForAgent(agentId),
    memory: teamMemory,
  });
  const routines = defaultRoutines();
  const actions = new LiveSchedulerActions(
    createDefaultActionRegistry(),
    options.registry,
    options.eventBus,
    options.agents,
  );
  const scheduler = new AgentScheduler({
    agents: options.agents,
    routines,
    perception: new LivePerceptionProvider(options.registry, context, teamMemory),
    actions,
    planner: new LiveDecisionPlanner(
      options.registry,
      context,
      subteams,
      routines,
      teamGoals,
      teamMemory,
      options.agents,
      llmProviders,
      competitive,
      coordination,
    ),
    events: {
      publish(event) {
        logSchedulerEvent(event);
        emitSchedulerTraceEvent(options.eventBus, event);
      },
    },
    config: {
      maxConcurrentActions: options.maxConcurrentActions,
      maxPlanningSlots: options.maxPlanningSlots,
      planningCooldownMs: options.planningCooldownMs,
    },
  });
  const briefedTeamTasks = new Set<string>();
  const emitSubteamBriefing = (subteamId: string, task: string, topic: "leader-briefing" | "subteam-task") => {
    emitAiSubteamBriefing(options.eventBus, subteams, briefedTeamTasks, subteamId, task, topic);
  };

  const unsubscribers = [
    options.eventBus.subscribe("game.event", (event) => {
      context.addEvent(event);
      const chat = chatFromGameEvent(event, options.agents);
      if (chat) {
        context.addChat(chat);
      }
      const briefingTask = briefingTaskFromDirectorEvent(event);
      if (briefingTask) {
        for (const subteamId of subteamIdsForDirectorEvent(event, subteams)) {
          emitSubteamBriefing(subteamId, briefingTask, "leader-briefing");
        }
      }
      for (const wakeEvent of wakeEventsFromGameEvent(event, options.agents)) {
        scheduler.handleEvent(wakeEvent);
      }
    }),
    options.eventBus.subscribe("chat.message", (message) => {
      context.addChat(message);
      const briefingTask = briefingTaskFromDirectorChat(message);
      if (briefingTask) {
        for (const subteamId of subteamIdsForChatMessage(message, subteams)) {
          context.setSubteamTask(subteamId, briefingTask);
          emitSubteamBriefing(subteamId, briefingTask, "leader-briefing");
          for (const agentId of context.agentIdsForSubteam(subteamId)) {
            scheduler.queuePlanning(agentId, { type: "direct_mention" });
          }
        }
      }
      for (const recipientId of message.recipientIds) {
        scheduler.queuePlanning(recipientId, { type: "direct_mention" });
      }
    }),
    options.eventBus.subscribe("action.result", (result) => {
      teamGoals.recordActionResult(result);
      competitive.recordActionResult(result);
      if (!result.ok) {
        coordination.blocked(result.agentId, result.error ?? `${result.action} failed`);
      } else if (context.hasActiveGoal(result.agentId)) {
        coordination.completed(result.agentId, result.action);
      }
      if (context.hasActiveGoal(result.agentId)) {
        scheduler.queuePlanning(result.agentId, { type: "manual" });
      }
    }),
    options.eventBus.subscribe("director.command", (command) => {
      if (command.type === "pause-all") {
        for (const agentId of scheduler.agentIds()) scheduler.pauseAgent(agentId);
      } else if (command.type === "pause-agent" && command.targetAgentId) {
        scheduler.pauseAgent(command.targetAgentId);
      } else if (command.type === "resume-all") {
        for (const agentId of scheduler.agentIds()) scheduler.resumeAgent(agentId);
      } else if (command.type === "resume-agent" && command.targetAgentId) {
        scheduler.resumeAgent(command.targetAgentId);
      } else if (command.type === "set-agent-role" && command.targetAgentId) {
        context.setAgentRole(command.targetAgentId, stringPayload(command.payload.role) ?? stringPayload(command.payload.text) ?? "");
        scheduler.queuePlanning(command.targetAgentId, { type: "manual" });
      } else if (command.type === "set-agent-task" && command.targetAgentId) {
        context.setAgentTask(
          command.targetAgentId,
          stringPayload(command.payload.task) ?? stringPayload(command.payload.text) ?? "",
          stringPayload(command.payload.taskId),
        );
        scheduler.queuePlanning(command.targetAgentId, { type: "manual" });
      } else if (command.type === "set-subteam-task") {
        const subteamId = stringPayload(command.payload.subteamId);
        if (subteamId) {
          context.setSubteamTask(
            subteamId,
            stringPayload(command.payload.task) ?? stringPayload(command.payload.text) ?? "",
            stringPayload(command.payload.taskId),
          );
          emitSubteamBriefing(
            subteamId,
            stringPayload(command.payload.task) ?? stringPayload(command.payload.text) ?? "",
            "subteam-task",
          );
          for (const agentId of context.agentIdsForSubteam(subteamId)) {
            scheduler.queuePlanning(agentId, { type: "manual" });
          }
        }
      } else if (command.type === "inject-agent-context") {
        context.addDirectorContext({
          scope: stringPayload(command.payload.scope) ?? "all",
          agentId: command.targetAgentId ?? stringPayload(command.payload.agentId),
          subteamId: stringPayload(command.payload.subteamId),
          kind: stringPayload(command.payload.kind) ?? "instruction",
          text: stringPayload(command.payload.text) ?? stringPayload(command.payload.content) ?? "",
        });
        for (const agentId of context.agentIdsForCommand(command.payload, command.targetAgentId)) {
          scheduler.queuePlanning(agentId, { type: "manual" });
        }
      } else if (command.type === "god-dialogue") {
        const recipientIds = context.agentIdsForCommand(command.payload, command.targetAgentId);
        options.eventBus.emit("chat.message", {
          id: randomUUID(),
          senderId: "gods",
          recipientIds,
          topic: "god-dialogue",
          urgency: 5,
          visibility: "ai",
          content: stringPayload(command.payload.content) ?? stringPayload(command.payload.text) ?? "",
          timestamp: new Date().toISOString(),
        });
      } else if (command.type === "add-agent") {
        const agent = agentConfigFromPayload(command.payload.agent);
        if (agent) {
          addRuntimeAgent(agent, {
            registry: options.registry,
            scheduler,
            context,
            subteams,
            actions,
            competitive,
            connectAgent: options.connectAgent,
          });
        }
      }
    }),
  ];

  let interval: ReturnType<typeof setInterval> | undefined;
  let ticking = false;

  return {
    scheduler,
    competitive,
    start() {
      if (interval) return;
      interval = setInterval(() => {
        if (ticking) return;
        ticking = true;
        scheduler.tick()
          .catch((error: unknown) => {
            console.error(`live scheduler tick failed: ${formatError(error)}`);
          })
          .finally(() => {
            ticking = false;
          });
      }, options.tickMs);
    },
    async stop() {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      await scheduler.waitForIdle();
    },
  };
}

class LiveContext {
  private readonly recentEvents: GameEvent[] = [];
  private readonly recentChat: AiChatMessage[] = [];
  private readonly agents: AgentConfig[] = [];
  private readonly byAgentId = new Map<string, AgentConfig>();
  private readonly agentTasks = new Map<string, { task: string; taskId?: string }>();
  private readonly subteamTasks = new Map<string, { task: string; taskId?: string }>();
  private readonly roleOverrides = new Map<string, string>();
  private readonly globalContext: string[] = [];
  private readonly subteamContext = new Map<string, string[]>();
  private readonly agentContext = new Map<string, string[]>();
  private currentInstruction?: string;

  constructor(
    private readonly subteams: SubteamDirectory,
    agents: AgentConfig[],
  ) {
    for (const agent of agents) this.addAgent(agent);
  }

  addAgent(agent: AgentConfig): boolean {
    if (this.byAgentId.has(agent.id)) {
      return false;
    }
    this.byAgentId.set(agent.id, agent);
    this.agents.push(agent);
    this.agents.sort((left, right) => left.id.localeCompare(right.id));
    return true;
  }

  addEvent(event: GameEvent): void {
    this.recentEvents.push(event);
    trim(this.recentEvents, MAX_RECENT_EVENTS);

    const content = stringPayload(event.payload.content) ?? stringPayload(event.payload.message);
    if (content && isDirectorMessageEvent(event)) {
      this.setInstruction(content, { assignToSubteams: event.type !== "player_chat" });
    }
  }

  addChat(message: AiChatMessage): void {
    this.recentChat.push(message);
    trim(this.recentChat, MAX_RECENT_CHAT);
    if (message.senderId === "director" && message.recipientIds.length === 0) {
      this.setInstruction(message.content);
    }
  }

  eventsForAgent(agentId: string): GameEvent[] {
    return this.recentEvents.filter((event) =>
      event.actorId === agentId ||
      event.targetId === agentId ||
      stringArrayPayload(event.payload.agentIds).includes(agentId) ||
      stringArrayPayload(event.payload.recipientIds).includes(agentId) ||
      isDirectorMessageEvent(event),
    );
  }

  chatForAgent(agentId: string): AiChatMessage[] {
    return this.recentChat.filter((message) =>
      message.senderId === agentId ||
      message.recipientIds.includes(agentId) ||
      message.recipientIds.length === 0 ||
      message.visibility === "public",
    );
  }

  instruction(): string | undefined {
    return this.currentInstruction;
  }

  teamGoal(agentId: string): string | undefined {
    const team = this.subteams.teamForAgent(agentId);
    return team ? this.subteamTasks.get(team.id)?.task ?? this.currentInstruction : this.currentInstruction;
  }

  objectiveCandidatesForAgent(agentId: string): string[] {
    const team = this.subteams.teamForAgent(agentId);
    return uniqueStrings([
      this.agentTask(agentId),
      team ? this.subteamTasks.get(team.id)?.task : undefined,
      this.currentInstruction,
      ...[...this.subteamTasks.values()].map((task) => task.task),
    ]);
  }

  hasActiveGoal(agentId: string): boolean {
    return Boolean(this.teamGoal(agentId)?.trim() || this.agentTask(agentId)?.trim());
  }

  agentTask(agentId: string): string | undefined {
    return this.agentTasks.get(agentId)?.task;
  }

  roleForAgent(agentId: string): string | undefined {
    return this.roleOverrides.get(agentId);
  }

  setAgentRole(agentId: string, role: string): void {
    const trimmed = role.trim();
    if (trimmed) this.roleOverrides.set(agentId, trimmed);
  }

  setAgentTask(agentId: string, task: string, taskId?: string): void {
    const trimmed = task.trim();
    if (trimmed) this.agentTasks.set(agentId, { task: trimmed, taskId });
  }

  setSubteamTask(subteamId: string, task: string, taskId?: string): void {
    const trimmed = task.trim();
    if (trimmed) this.subteamTasks.set(subteamId, { task: trimmed, taskId });
  }

  addDirectorContext(input: {
    scope: string;
    agentId?: string;
    subteamId?: string;
    kind: string;
    text: string;
  }): void {
    const text = `${input.kind}: ${input.text.trim()}`;
    if (!input.text.trim()) return;
    if (input.scope === "agent" && input.agentId) {
      pushLimited(this.agentContext, input.agentId, text, 8);
      return;
    }
    if (input.scope === "subteam" && input.subteamId) {
      pushLimited(this.subteamContext, input.subteamId, text, 8);
      return;
    }
    this.globalContext.push(text);
    trim(this.globalContext, 8);
  }

  directorNotes(agentId: string): string[] {
    const notes: string[] = [];
    const role = this.roleOverrides.get(agentId);
    const task = this.agentTasks.get(agentId);
    const team = this.subteams.teamForAgent(agentId);
    if (role) notes.push(`Current director role override: ${role}`);
    if (task) notes.push(`Individual task${task.taskId ? ` ${task.taskId}` : ""}: ${task.task}`);
    if (team) {
      const teamTask = this.subteamTasks.get(team.id);
      if (teamTask) notes.push(`Team task${teamTask.taskId ? ` ${teamTask.taskId}` : ""}: ${teamTask.task}`);
      notes.push(...(this.subteamContext.get(team.id) ?? []));
    }
    notes.push(...(this.agentContext.get(agentId) ?? []), ...this.globalContext);
    return notes;
  }

  agentIds(): string[] {
    return this.agents.map((agent) => agent.id);
  }

  agentUsernames(): string[] {
    return this.agents.map((agent) => agent.account.username);
  }

  agentIdsForSubteam(subteamId: string): string[] {
    return this.subteams.list().find((team) => team.id === subteamId)?.memberIds ?? [];
  }

  agentIdsForCommand(payload: Record<string, JsonValue>, targetAgentId?: string): string[] {
    const scope = stringPayload(payload.scope);
    const agentId = targetAgentId ?? stringPayload(payload.agentId);
    const subteamId = stringPayload(payload.subteamId);
    if (scope === "agent" && agentId) return this.byAgentId.has(agentId) ? [agentId] : [];
    if (scope === "subteam" && subteamId) return this.agentIdsForSubteam(subteamId);
    if (agentId) return this.byAgentId.has(agentId) ? [agentId] : [];
    if (subteamId) return this.agentIdsForSubteam(subteamId);
    return this.agentIds();
  }

  attackTargetUsername(): string | undefined {
    const instruction = [
      this.currentInstruction,
      ...this.agentTasks.values(),
      ...this.subteamTasks.values(),
    ]
      .filter((item): item is string | { task: string; taskId?: string } => item !== undefined)
      .map((item) => typeof item === "string" ? item : item.task)
      .join("\n");
    const match = /\b(?:kill|attack|eliminate)\s+([A-Za-z0-9_]{3,16})\b/i.exec(instruction);
    return match?.[1];
  }

  otherAgentIds(agentId: string): string[] {
    return this.agents.map((agent) => agent.id).filter((id) => id !== agentId);
  }

  private setInstruction(content: string, options: { assignToSubteams?: boolean } = {}): void {
    this.currentInstruction = content;
    if (options.assignToSubteams === false) return;
    for (const team of this.subteams.list()) {
      this.subteamTasks.set(team.id, { task: content });
    }
  }
}

class RuntimeCoordinationMessages {
  private readonly sentAt = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly eventBus: StudioEventBus,
    private readonly subteams: SubteamDirectory,
    now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  danger(agentId: string, content: string): void {
    this.emit(agentId, "danger", content, 4, 20_000);
  }

  blocked(agentId: string, reason: string): void {
    this.emit(agentId, "blocked", `Blocked: ${clampMessage(reason)}. Trying another plan.`, 3, 30_000);
  }

  fallback(agentId: string, reason: string): void {
    this.emit(agentId, "fallback", `Fallback: ${clampMessage(reason)}.`, 2, 30_000);
  }

  completed(agentId: string, action: string): void {
    if (!["craft_item", "place_block", "mine_block", "collect_item", "attack_entity"].includes(action)) {
      return;
    }
    this.emit(agentId, "progress", `Finished ${action.replace(/_/g, " ")}; continuing team goal.`, 2, 60_000);
  }

  private emit(
    agentId: string,
    topic: string,
    content: string,
    urgency: EventSeverity,
    cooldownMs: number,
  ): void {
    const recipientIds = this.subteams.resolveRecipients(agentId, {});
    if (recipientIds.length === 0) return;

    const key = `${agentId}:${topic}:${normalizeTaskText(content)}`;
    const now = this.now();
    if (now - (this.sentAt.get(key) ?? 0) < cooldownMs) {
      return;
    }
    this.sentAt.set(key, now);

    this.eventBus.emit("chat.message", {
      id: randomUUID(),
      senderId: agentId,
      recipientIds,
      topic,
      urgency,
      visibility: "ai",
      content,
      timestamp: new Date(now).toISOString(),
    });
  }
}

class LivePerceptionProvider implements PerceptionProvider {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly context: LiveContext,
    private readonly teamMemory: TeamMemoryStore,
  ) {}

  async snapshot(agent: AgentConfig): Promise<RoutinePerceptionSnapshot> {
    const bot = this.registry.getBot(agent.id);
    const snapshot = bot
      ? routinePerceptionFromBot(agent.id, bot, this.context.eventsForAgent(agent.id), this.context.attackTargetUsername(), this.context.agentUsernames())
      : emptyRoutinePerception(agent.id);
    this.teamMemory.recordPerception(agent.id, snapshot, bot?.inventory?.items());
    return snapshot;
  }
}

interface CompetitiveLiveCoordinatorOptions {
  agents: AgentConfig[];
  subteams: SubteamDirectory;
  registry: AgentRegistry;
  providers: LlmProviderRegistry;
  now?: () => number;
}

interface CompetitivePlanInput {
  agent: AgentConfig;
  perception: RoutinePerceptionSnapshot;
  goal?: string;
}

class CompetitiveLiveCoordinator implements LiveCompetitiveRuntime {
  private readonly agentsById = new Map<string, AgentConfig>();
  private readonly memories = new Map<string, TeamMemory>();
  private readonly orchestrators = new Map<string, CompetitiveTeamOrchestrator>();
  private readonly blueprintRegistry = BlueprintRegistry.withDefaults();
  private readonly llmQueue = new LLMRequestQueue({
    minDelayMs: readIntegerEnv("LIVE_COMPETITIVE_LLM_MIN_DELAY_MS", 200),
    maxDelayMs: readIntegerEnv("LIVE_COMPETITIVE_LLM_MAX_DELAY_MS", 500),
  });
  private readonly pendingBlueprintByAgentId = new Map<string, string>();
  private readonly now: () => number;

  constructor(private readonly options: CompetitiveLiveCoordinatorOptions) {
    this.now = options.now ?? Date.now;
    for (const agent of options.agents) this.addAgent(agent);
  }

  addAgent(agent: AgentConfig): void {
    this.agentsById.set(agent.id, agent);
  }

  plan(input: CompetitivePlanInput): { handled: boolean; action?: RoutineActionIntent; note?: string } {
    const goal = input.goal?.trim();
    if (!isCompetitiveObjective(goal)) {
      return { handled: false };
    }

    const team = this.options.subteams.teamForAgent(input.agent.id);
    if (!team) return { handled: false };

    const memory = this.memoryForTeam(team.id, team.memberIds);
    this.syncTeamResources(memory, team.memberIds);
    this.syncTeamGear(memory, team.memberIds);
    this.syncThreat(memory, input.agent, input.perception);

    const bot = this.options.registry.getBot(input.agent.id);
    const capableAgent: AgentConfig = {
      ...input.agent,
      allowedActions: availableLiveActions(input.agent, bot),
    };
    const orchestrator = this.orchestratorForTeam(team.id, memory);
    const action = orchestrator.planNextAction({
      agent: capableAgent,
      bot,
      perception: input.perception,
    });
    if (!action) {
      return {
        handled: false,
        note: "competitive objective active but no deterministic action is currently available",
      };
    }

    this.recordPlannedAction(input.agent.id, action);
    return {
      handled: true,
      action,
      note: `competitive ${memory.currentPhase()} ${memory.roleFor(input.agent.id)}`,
    };
  }

  recordActionResult(result: ActionResult): void {
    if (result.action !== "place_block") return;

    const blueprintId = this.pendingBlueprintByAgentId.get(result.agentId);
    this.pendingBlueprintByAgentId.delete(result.agentId);
    if (!result.ok || !blueprintId) return;

    const team = this.options.subteams.teamForAgent(result.agentId);
    if (!team) return;
    const memory = this.memories.get(team.id);
    if (!memory) return;

    memory.recordBlueprintPlacement(result.agentId, blueprintId);
  }

  snapshot(teamId: string): TeamMemorySnapshot | undefined {
    return this.memories.get(teamId)?.snapshot();
  }

  snapshots(): TeamMemorySnapshot[] {
    return [...this.memories.values()]
      .map((memory) => memory.snapshot())
      .sort((left, right) => left.teamId.localeCompare(right.teamId));
  }

  private memoryForTeam(teamId: string, memberIds: string[]): TeamMemory {
    const existing = this.memories.get(teamId);
    if (existing) return existing;

    const memory = new TeamMemory({
      teamId,
      agentIds: memberIds,
      blueprints: this.blueprintsForTeam(teamId),
      now: this.now,
    });
    this.memories.set(teamId, memory);
    return memory;
  }

  private orchestratorForTeam(teamId: string, memory: TeamMemory): CompetitiveTeamOrchestrator {
    const existing = this.orchestrators.get(teamId);
    if (existing) return existing;

    const orchestrator = new CompetitiveTeamOrchestrator({
      memory,
      llmQueue: this.llmQueue,
      buildLlmRequest: (eventName, agentIds) => this.buildLlmRequest(teamId, memory, eventName, agentIds),
    });
    this.orchestrators.set(teamId, orchestrator);
    return orchestrator;
  }

  private blueprintsForTeam(teamId: string) {
    return this.blueprintRegistry.createVillagePlan(
      {
        residential: readIntegerEnv("LIVE_COMPETITIVE_RESIDENTIAL_COUNT", 2),
        farm: readIntegerEnv("LIVE_COMPETITIVE_FARM_COUNT", 1),
        blacksmith: readIntegerEnv("LIVE_COMPETITIVE_BLACKSMITH_COUNT", 1),
        watchtower: readIntegerEnv("LIVE_COMPETITIVE_WATCHTOWER_COUNT", 1),
      },
      seededRandom(teamId),
    );
  }

  private syncTeamResources(memory: TeamMemory, memberIds: string[]): void {
    const totals = new Map<string, number>();
    for (const agentId of memberIds) {
      for (const item of this.options.registry.getBot(agentId)?.inventory?.items() ?? []) {
        totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
      }
    }

    const tracked = new Set([
      ...Object.keys(memory.snapshot().sharedResources),
      ...memory.materialDeficits().keys(),
      ...totals.keys(),
    ]);

    for (const item of tracked) {
      memory.setSharedResource(item, totals.get(item) ?? 0);
    }
  }

  private syncTeamGear(memory: TeamMemory, memberIds: string[]): void {
    for (const agentId of memberIds) {
      const gear = (this.options.registry.getBot(agentId)?.inventory?.items() ?? [])
        .map((item) => item.name)
        .filter((name) => /sword|shield|bow|crossbow|helmet|chestplate|leggings|boots|axe/i.test(name));
      if (gear.length > 0) memory.assignGear(agentId, gear);
    }
  }

  private syncThreat(
    memory: TeamMemory,
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
  ): void {
    const protectedUsernames = new Set([...this.agentsById.values()].map((item) => item.account.username.toLowerCase()));
    const visibleHuman = perception.nearbyPlayers.find((player) =>
      player.name.toLowerCase() !== agent.account.username.toLowerCase()
      && player.protected !== true
      && !protectedUsernames.has(player.name.toLowerCase()),
    );
    if (!visibleHuman) return;

    const bot = this.options.registry.getBot(agent.id);
    const entity = Object.values(bot?.entities ?? {}).find((candidate) =>
      candidate.type === "player"
      && candidate.username?.toLowerCase() === visibleHuman.name.toLowerCase()
      && candidate.position,
    );
    const position = toPosition(entity?.position);
    if (!position) return;

    memory.spotPlayer(position, visibleHuman.threatening ? "high" : "medium", visibleHuman.name);
  }

  private recordPlannedAction(agentId: string, action: RoutineActionIntent): void {
    const blueprintId = stringParam(action.params.blueprintId);
    if (action.action === "place_block" && blueprintId) {
      this.pendingBlueprintByAgentId.set(agentId, blueprintId);
      return;
    }
    this.pendingBlueprintByAgentId.delete(agentId);
  }

  private buildLlmRequest(
    teamId: string,
    memory: TeamMemory,
    eventName: string,
    agentIds: string[],
  ) {
    const plannerAgent = this.plannerAgent(agentIds);
    if (!plannerAgent) return undefined;
    const snapshot = memory.snapshot();
    return {
      agentId: plannerAgent.id,
      reason: eventName,
      execute: async () => {
        const result = await this.options.providers.generateStructured({
          provider: plannerAgent.providerRef || "deepseek",
          model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
          system: "You are a Minecraft competitive team strategist. Return strict JSON only.",
          messages: [{
            role: "user",
            content: [
              `Team ${teamId} major event: ${eventName}.`,
              "Return exactly {\"nextBestAction\":\"...\",\"targetCoordinates\":[x,y,z]}.",
              "Keep the action high level; deterministic Mineflayer routines will execute movement, building, and combat.",
              `Snapshot: ${JSON.stringify(snapshot).slice(0, 3_000)}`,
            ].join("\n"),
          }],
          schemaName: "CompetitiveTeamDecision",
          temperature: 0.2,
          timeoutMs: readIntegerEnv("LIVE_COMPETITIVE_LLM_TIMEOUT_MS", 8_000),
        }, LLMResponseSchema);

        if (!result.ok) {
          throw new Error(`${result.error.code}: ${result.error.message}`);
        }
        return result.value;
      },
    };
  }

  private plannerAgent(agentIds: string[]): AgentConfig | undefined {
    const candidates = agentIds
      .map((agentId) => this.agentsById.get(agentId))
      .filter((agent): agent is AgentConfig => Boolean(agent))
      .sort((left, right) =>
        Number(right.leader === true) - Number(left.leader === true)
        || left.id.localeCompare(right.id),
      );
    return candidates[0];
  }
}

class LiveDecisionPlanner implements DecisionPlanner {
  private readonly decisions: AgentDecisionService;
  private readonly scoutTargets = new Map<string, Position>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly context: LiveContext,
    private readonly subteams: SubteamDirectory,
    private readonly routines: Map<string, Routine>,
    private readonly teamGoals: TeamGoalController,
    private readonly teamMemory: TeamMemoryStore,
    private readonly agents: AgentConfig[],
    providers: LlmProviderRegistry,
    private readonly competitive: CompetitiveLiveCoordinator,
    private readonly coordination: RuntimeCoordinationMessages,
  ) {
    this.decisions = new AgentDecisionService(providers);
  }

  async plan(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
    reason: WakeReason,
    _signal: AbortSignal,
  ): Promise<{ action?: RoutineActionIntent; note?: string }> {
    const bot = this.registry.getBot(agent.id);
    const botPerception = bot
      ? createPerceptionSnapshot({
          agentId: agent.id,
          bot,
          recentEvents: this.context.eventsForAgent(agent.id),
        })
      : undefined;
    const activeGoal = this.context.teamGoal(agent.id);
    const assignedTask = this.context.agentTask(agent.id);
    const eventTask = reason.event
      ? `${reason.type}: ${eventText(reason.event)}`
      : undefined;
    const currentTask = eventTask ?? assignedTask ?? activeGoal;
    const objectiveTask = assignedTask ?? activeGoal ?? currentTask;
    const competitiveGoal = this.context.objectiveCandidatesForAgent(agent.id).find(isCompetitiveObjective) ?? objectiveTask;
    const fallbackNotes: string[] = [];
    const survivalIntent = this.survivalThreatIntent(agent, perception);
    if (survivalIntent) {
      const target = stringParam(survivalIntent.params.entityType) ?? stringParam(survivalIntent.params.entityId) ?? "hostile";
      this.coordination.danger(
        agent.id,
        `${target} nearby; ${survivalIntent.action === "flee" ? "falling back" : "engaging"}.`,
      );
      console.log(`[live-plan] ${agent.id} ${survivalIntent.action}: deterministic survival/threat response`);
      return {
        action: survivalIntent,
        note: "deterministic survival/threat response",
      };
    }

    const opportunisticIntent = this.opportunisticCollectIntent(agent, perception, bot);
    if (opportunisticIntent) {
      console.log(`[live-plan] ${agent.id} ${opportunisticIntent.action}: deterministic useful-drop collection`);
      return {
        action: opportunisticIntent,
        note: "deterministic useful-drop collection",
      };
    }

    const competitiveIntent = this.competitive.plan({
      agent,
      perception,
      goal: competitiveGoal,
    });
    if (competitiveIntent.handled) {
      console.log(
        competitiveIntent.action
          ? `[live-plan] ${agent.id} ${competitiveIntent.action.action}: ${competitiveIntent.note ?? "competitive orchestration"}`
          : `[live-plan] ${agent.id} no action: ${competitiveIntent.note ?? "competitive orchestration"}`,
      );
      return competitiveIntent;
    }
    if (competitiveIntent.note) {
      fallbackNotes.push(competitiveIntent.note);
    }

    const teamIntent = this.teamGoals.plan({
      agent,
      perception,
      goal: objectiveTask,
      attackTargetUsername: this.context.attackTargetUsername(),
    });
    if (teamIntent.action) {
      console.log(`[live-plan] ${agent.id} ${teamIntent.action.action}: ${teamIntent.note ?? "team autonomy"}`);
      return teamIntent;
    }
    if (teamIntent.note) {
      fallbackNotes.push(teamIntent.note);
      this.coordination.blocked(agent.id, teamIntent.note);
      console.log(`[live-plan] ${agent.id} fallback: ${teamIntent.note}; trying LLM decision`);
    }

    const result = await this.decisions.decide({
      agent,
      model: {
        provider: agent.providerRef || "deepseek",
        model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL,
        timeoutMs: readIntegerEnv("LIVE_AGENT_LLM_TIMEOUT_MS", 12_000),
        temperature: 0.35,
      },
      staticPersona: personaForAgent(agent, this.context.roleForAgent(agent.id)),
      dynamicState: {
        mode: this.registry.get(agent.id)?.mode,
        health: bot?.health ?? perception.health,
        food: bot?.food,
        position: toPosition(bot?.entity?.position),
        activeGoal,
        currentRoutine: agent.routine,
        currentTask,
        threatLevel: threatLevel(perception),
      },
      perception: promptPerception(botPerception, perception),
      recentChat: this.context.chatForAgent(agent.id),
      recentEvents: this.context.eventsForAgent(agent.id),
      memories: [
        {
          id: "subteam-roster",
          summary: `Subteams and leaders: ${this.subteams.describeForAgent(agent.id)}`,
          importance: 5,
        },
        {
          id: "leader-username",
          summary: agent.leader
            ? `You are the subteam leader; scout with move_to and do not follow yourself.`
            : `Your leader Minecraft username is ${this.subteams.leaderUsernameForAgent(agent.id) ?? "unknown"}.`,
          importance: 5,
        },
        {
          id: "subteam-goal",
          summary: `Your subteam goal: ${this.context.teamGoal(agent.id) ?? "no active goal"}`,
          importance: 5,
        },
        ...teamMemoryPromptMemories(this.teamMemory, agent.id),
        ...this.context.directorNotes(agent.id).map((summary, index) => ({
          id: `director-context-${index}`,
          summary,
          importance: 5 as const,
        })),
        ...recipeKnowledgeMemories({
          goal: activeGoal,
          task: currentTask,
          role: agent.role,
          inventoryItemNames: bot?.inventory?.items().map((item) => item.name),
          version: bot?.version,
        }),
      ],
      availableActions: availableLiveActions(agent, bot),
      constraints: [
        "Respond to director AI chat as a task assignment unless it is clearly casual.",
        "Coordinate first with your subteam. Your private team chat is chat_ai_private without explicit recipients.",
        "To communicate with another subteam, use chat_ai_private with subteamId set to that subteam id or leadersOnly=true for leaders.",
        "If you are a subteam leader, assign work to your own members using chat_ai_private.",
        "Use recent team memory for routine coordination before chat; do not chat routine following or status updates.",
        "If you are a subteam leader, do not use follow_player on yourself; use move_to to scout a nearby build site.",
        "If you are not the leader and the task says follow your leader, use follow_player targeting your leader username.",
        "For task assignments, prefer a physical action or continue_routine over chat.",
        "Use chat only to report completion, warn about danger, or ask a necessary clarifying question.",
        "Use continue_routine for role work when no exact movement or block target is known.",
        "If you need a tool or block and have ingredients, use craft_item before mining, building, or fighting.",
        "Use the crafting recipe and creative build guidance memories as hints, not rigid scripts.",
        "If choosing move_to, provide a nearby reachable position using x, y, z or position.",
        "For village-building tasks, use mine_block, collect_item, craft_item, move_to, and place_block when the needed target is visible or craftable.",
        "For attack tasks, use follow_player first if the target player is visible but not in range.",
        "Only attack a real player when the director goal explicitly says kill or attack that username.",
      ],
      maxContextChars: 4_000,
    });

    logLlmDecisionTrace(agent, result);

    const intent = this.decisionToIntent(agent, perception, result.decision);
    const fallbackReason = result.fallbackReason ? ` reason=${result.fallbackReason}` : "";
    const usage = formatLlmUsage(result.usage);
    if (result.fallback) {
      this.coordination.fallback(agent.id, result.fallbackReason ?? result.decision.reasoningSummary);
    }
    console.log(
      `[live-plan] ${agent.id} ${result.decision.action}`
        + `${result.fallback ? ` fallback${fallbackReason}` : ""}: ${result.decision.reasoningSummary}`
        + `${usage ? ` ${usage}` : ""}`,
    );
    return {
      action: intent,
      note: [...fallbackNotes, result.decision.reasoningSummary].join(" | "),
    };
  }

  private survivalThreatIntent(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
  ): RoutineActionIntent | undefined {
    const hostile = perception.nearbyEntities.find((entity) =>
      entity.hostile && entity.type !== "player" && entity.protected !== true,
    );
    if (hostile && perception.health <= 8 && agent.allowedActions.includes("flee")) {
      return {
        action: "flee",
        params: { entityId: hostile.id, reason: "fleeing immediate hostile threat while injured" },
        timeoutMs: 8_000,
        requestedBy: "live-survival",
      };
    }
    if (hostile && agent.allowedActions.includes("attack_entity")) {
      return {
        action: "attack_entity",
        params: { entityId: hostile.id, entityType: hostile.type, reason: "engaging immediate hostile threat" },
        timeoutMs: 8_000,
        requestedBy: "live-survival",
      };
    }
    return undefined;
  }

  private opportunisticCollectIntent(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
    bot: BotHandle | undefined,
  ): RoutineActionIntent | undefined {
    if (!agent.allowedActions.includes("collect_item") || !bot?.collectBlock) {
      return undefined;
    }
    if (perception.nearbyEntities.some((entity) => entity.hostile)) {
      return undefined;
    }
    const current = toPosition(bot.entity?.position);
    const item = perception.nearbyEntities.find((entity) => isAutonomousCollectTarget(entity, current));
    if (!item) {
      return undefined;
    }
    return {
      action: "collect_item",
      params: {
        entityId: item.id,
        item: item.type,
        reason: "collecting useful nearby dropped item before planning",
      },
      timeoutMs: 10_000,
      requestedBy: "live-survival",
    };
  }

  private decisionToIntent(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
    decision: AgentDecision,
  ): RoutineActionIntent | undefined {
    const formationIntent = this.teamFormationIntent(agent, perception, decision);
    if (formationIntent) {
      return formationIntent;
    }

    if (decision.action === "continue_routine") {
      const routine = this.routines.get(agent.routine ?? agent.role);
      const result = routine?.run(agent, perception);
      return result?.action ?? idleIntent("routine has no immediate action");
    }

    if (decision.action === "idle") {
      return {
        action: "idle",
        params: {
          durationMs: numberParam(decision.parameters.durationMs) ?? 1_000,
          reason: stringParam(decision.parameters.reason) ?? decision.intent,
        },
        timeoutMs: 2_000,
        requestedBy: "llm",
      };
    }

    if (decision.action === "chat_public") {
      const message = speechContent(decision)
        ?? stringParam(decision.parameters.message)
        ?? stringParam(decision.parameters.content)
        ?? decision.intent;
      return {
        action: "chat_public",
        params: { message: clampMessage(message) },
        timeoutMs: 3_000,
        requestedBy: "llm",
      };
    }

    if (decision.action === "chat_ai_private") {
      const recipients = this.subteams.resolveRecipients(agent.id, {
        ...jsonRecipientRequest(decision.parameters),
        recipientIds: decision.parameters.recipientIds ?? decision.speech?.recipientIds,
      });
      const message = speechContent(decision)
        ?? stringParam(decision.parameters.message)
        ?? stringParam(decision.parameters.content)
        ?? decision.intent;
      return {
        action: "chat_ai_private",
        params: {
          recipientIds: recipients,
          message: clampMessage(message),
          topic: stringParam(decision.parameters.topic) ?? decision.speech?.topic ?? "live_task",
        },
        timeoutMs: 3_000,
        requestedBy: "llm",
      };
    }

    if (decision.action === "follow_player") {
      const username = stringParam(decision.parameters.username)
        ?? stringParam(decision.parameters.player)
        ?? stringParam(decision.parameters.target)
        ?? this.subteams.leaderUsernameForAgent(agent.id);
      if (isSelfUsername(agent, username)) {
        const target = perception.patrolPoints?.[0];
        return target
          ? {
              action: "move_to",
              params: { position: target, range: 2, reason: "leader scouting instead of following self" },
              timeoutMs: 12_000,
              requestedBy: "llm",
            }
          : idleIntent("leader cannot follow self and has no scout point");
      }
      return {
        action: "follow_player",
        params: {
          ...jsonParams(decision.parameters),
          ...(username ? { username } : {}),
        },
        timeoutMs: 12_000,
        requestedBy: "llm",
      };
    }

    if (decision.action === "attack_entity") {
      const targetUsername = stringParam(decision.parameters.username)
        ?? stringParam(decision.parameters.target)
        ?? this.context.attackTargetUsername();
      return {
        action: "attack_entity",
        params: {
          ...jsonParams(decision.parameters),
          ...(targetUsername ? { username: targetUsername, directorOverride: true } : {}),
        },
        timeoutMs: 8_000,
        requestedBy: targetUsername ? "director" : "llm",
      };
    }

    return {
      action: decision.action,
      params: jsonParams(decision.parameters),
      timeoutMs: 10_000,
      requestedBy: "llm",
    };
  }

  private teamFormationIntent(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
    decision: AgentDecision,
  ): RoutineActionIntent | undefined {
    const goal = this.context.teamGoal(agent.id);
    if (!goal || !isTeamMovementGoal(goal)) {
      return undefined;
    }

    const leader = this.subteams.leaderForAgent(agent.id);
    const followUsername = stringParam(decision.parameters.username)
      ?? stringParam(decision.parameters.player)
      ?? stringParam(decision.parameters.target);
    const followsOwnLeader = Boolean(
      leader
      && followUsername
      && followUsername.toLowerCase() === leader.account.username.toLowerCase(),
    );
    const nonPhysicalChoice = ["idle", "continue_routine", "chat_public", "chat_ai_private"].includes(decision.action);
    const redundantFollow = decision.action === "follow_player" && this.isNearOwnLeader(agent, 6);
    const wrongLeaderFollow = decision.action === "follow_player"
      && leader
      && leader.id !== agent.id
      && !followsOwnLeader;
    const leaderTriedToFollow = decision.action === "follow_player" && agent.leader === true;
    const unhelpfulFlee = decision.action === "flee" && threatLevel(perception) !== "high"
      && !perception.nearbyEntities.some((entity) => entity.hostile);
    if (!nonPhysicalChoice && !unhelpfulFlee && !redundantFollow && !wrongLeaderFollow && !leaderTriedToFollow) {
      return undefined;
    }

    const contribution = this.roleContributionIntent(agent, perception, goal);
    if (contribution && (redundantFollow || !agent.leader)) {
      return contribution;
    }

    if (agent.leader === true) {
      const target = this.subteamScoutPoint(agent);
      const current = toPosition(this.registry.getBot(agent.id)?.entity?.position);
      if (current && target && positionDistance(current, target) <= 5) {
        return contribution;
      }
      return target
        ? {
            action: "move_to",
            params: { position: target, range: 3, reason: "active team goal scout/build-site movement" },
            timeoutMs: 15_000,
            requestedBy: "live-goal",
          }
        : undefined;
    }

    if (contribution) {
      return contribution;
    }

    if (!leader || leader.id === agent.id) {
      return undefined;
    }

    const leaderPosition = toPosition(this.registry.getBot(leader.id)?.entity?.position);
    const leaderVisible = Object.values(this.registry.getBot(agent.id)?.entities ?? {}).some((entity) =>
      entity.type === "player" && entity.username === leader.account.username,
    );
    if (!leaderVisible && leaderPosition) {
      return {
        action: "move_to",
        params: { position: leaderPosition, range: 4, reason: "moving toward leader position for active team goal" },
        timeoutMs: 15_000,
        requestedBy: "live-goal",
      };
    }

    return {
      action: "follow_player",
      params: { username: leader.account.username, range: 4, reason: "following subteam leader for active team goal" },
      timeoutMs: 15_000,
      requestedBy: "live-goal",
    };
  }

  private subteamScoutPoint(agent: AgentConfig): Position | undefined {
    const current = toPosition(this.registry.getBot(agent.id)?.entity?.position);
    if (!current) {
      return undefined;
    }
    const team = this.subteams.teamForAgent(agent.id);
    const cacheKey = team?.id ?? agent.id;
    const cached = this.scoutTargets.get(cacheKey);
    if (cached) {
      return cached;
    }
    const index = Math.max(0, this.subteams.list().findIndex((candidate) => candidate.id === team?.id));
    const offsets = [
      { x: 28, z: 0 },
      { x: -28, z: 0 },
      { x: 0, z: 28 },
      { x: 0, z: -28 },
      { x: 20, z: 20 },
      { x: -20, z: 20 },
      { x: 20, z: -20 },
      { x: -20, z: -20 },
    ];
    const offset = offsets[index % offsets.length] ?? offsets[0];
    const target = {
      x: Math.floor(current.x + offset.x),
      y: Math.floor(current.y),
      z: Math.floor(current.z + offset.z),
      world: current.world,
    };
    this.scoutTargets.set(cacheKey, target);
    return target;
  }

  private isNearOwnLeader(agent: AgentConfig, maxDistance: number): boolean {
    const leader = this.subteams.leaderForAgent(agent.id);
    if (!leader || leader.id === agent.id) {
      return false;
    }
    const leaderUsername = leader.account.username;
    const visibleLeader = Object.values(this.registry.getBot(agent.id)?.entities ?? {}).find((entity) =>
      entity.type === "player" && entity.username === leaderUsername,
    );
    if (visibleLeader?.position && this.registry.getBot(agent.id)?.entity?.position) {
      return positionDistance(this.registry.getBot(agent.id)?.entity?.position, visibleLeader.position) <= maxDistance;
    }
    const leaderPosition = this.registry.getBot(leader.id)?.entity?.position;
    const selfPosition = this.registry.getBot(agent.id)?.entity?.position;
    return Boolean(leaderPosition && selfPosition && positionDistance(selfPosition, leaderPosition) <= maxDistance);
  }

  private roleContributionIntent(
    agent: AgentConfig,
    perception: RoutinePerceptionSnapshot,
    goal: string,
  ): RoutineActionIntent | undefined {
    const bot = this.registry.getBot(agent.id);
    const role = (this.context.roleForAgent(agent.id) ?? agent.role).toLowerCase();
    if (isAttackGoal(goal)) {
      const target = this.context.attackTargetUsername();
      if (
        target
        && agent.allowedActions.includes("attack_entity")
        && perception.nearbyPlayers.some((player) => player.name.toLowerCase() === target.toLowerCase())
      ) {
        return {
          action: "attack_entity",
          params: { username: target, directorOverride: true, reason: "director-approved attack target visible" },
          timeoutMs: 8_000,
          requestedBy: "director",
        };
      }
    }

    const blockToMine = perception.visibleBlocks.find((block) =>
      /stone|deepslate|dirt|gravel|coal_ore|iron_ore|copper_ore|log|wood/.test(block.type)
      && block.safe !== false
      && block.belowAgent !== true,
    );
    if (blockToMine && agent.allowedActions.includes("mine_block")) {
      return {
        action: "mine_block",
        params: { position: blockToMine.position, block: blockToMine.type, reason: "gathering village/base materials" },
        timeoutMs: 12_000,
        requestedBy: "live-goal",
      };
    }

    const current = toPosition(bot?.entity?.position);
    const item = perception.nearbyEntities.find((entity) => isAutonomousCollectTarget(entity, current));
    if (item && agent.allowedActions.includes("collect_item")) {
      return {
        action: "collect_item",
        params: { entityId: item.id, item: item.type, reason: "collecting supplies for team goal" },
        timeoutMs: 10_000,
        requestedBy: "live-goal",
      };
    }

    const placeTarget = nearbyBuildPosition(bot);
    if (placeTarget && agent.allowedActions.includes("place_block") && hasPlaceableInventory(bot)) {
      return {
        action: "place_block",
        params: { position: placeTarget, reason: "placing first blocks for village/base" },
        timeoutMs: 10_000,
        requestedBy: "live-goal",
      };
    }

    if (current && agent.allowedActions.includes("move_to")) {
      const offset = role.includes("guard")
        ? { x: 8, z: 0 }
        : role.includes("miner")
          ? { x: 0, z: 8 }
          : { x: -5, z: 5 };
      return {
        action: "move_to",
        params: {
          position: {
            x: Math.floor(current.x + offset.x),
            y: Math.floor(current.y),
            z: Math.floor(current.z + offset.z),
            world: current.world,
          },
          range: 2,
          reason: "spreading around team build site for role work",
        },
        timeoutMs: 10_000,
        requestedBy: "live-goal",
      };
    }

    return undefined;
  }
}

class LiveSchedulerActions implements SchedulerActionRegistry {
  private readonly policy: ActionPolicy;

  constructor(
    private readonly actions: RuntimeActionRegistry,
    private readonly registry: AgentRegistry,
    private readonly eventBus: StudioEventBus,
    agents: AgentConfig[],
  ) {
    this.policy = {
      protectedPlayerUsernames: agents.map((agent) => agent.account.username),
      playerTeams: Object.fromEntries(
        agents.map((agent) => [agent.account.username.toLowerCase(), agent.team ?? "ai"]),
      ),
      chatCooldownMs: 750,
      maxMoveDistance: 512,
      maxCollectDistance: 128,
      maxMineDistance: 8,
      allowDirectorAttackOverride: true,
    };
  }

  addAgent(agent: AgentConfig): void {
    this.policy.protectedPlayerUsernames = [
      ...new Set([...(this.policy.protectedPlayerUsernames ?? []), agent.account.username]),
    ];
    this.policy.playerTeams = {
      ...(this.policy.playerTeams ?? {}),
      [agent.account.username.toLowerCase()]: agent.team ?? "ai",
    };
  }

  canRun(agent: AgentConfig, request: ActionRequest): boolean {
    const action = this.actions.get(request.action);
    if (!action) {
      return this.rejectPreflight(agent, request, `unknown action: ${request.action}`);
    }
    if (!agent.allowedActions.includes(action.name)) {
      return this.rejectPreflight(agent, request, `action not allowed for agent: ${action.name}`);
    }
    const result = action.canRun(this.context(agent), request);
    if (!result.ok) {
      return this.rejectPreflight(agent, request, result.reason);
    }
    return result.ok;
  }

  async run(agent: AgentConfig, request: ActionRequest, signal: AbortSignal): Promise<ActionResult> {
    const result = await this.actions.run(request, this.context(agent), signal);
    this.eventBus.emit("action.result", result);
    if (!result.ok) {
      console.warn(`[live-action] ${agent.id}:${request.action} failed: ${result.error ?? "unknown"}`);
    }
    return result;
  }

  private context(agent: AgentConfig) {
    return {
      agent,
      bot: this.registry.getBot(agent.id),
      chatBus: {
        publish: (input: AiChatPublishInput) => {
          const message: AiChatMessage = {
            id: randomUUID(),
            senderId: input.senderId,
            recipientIds: input.recipientIds,
            topic: input.topic,
            urgency: input.urgency,
            visibility: input.visibility,
            content: input.content,
            timestamp: new Date().toISOString(),
          };
          this.eventBus.emit("chat.message", message);
          return message;
        },
      },
      policy: this.policy,
    };
  }

  private rejectPreflight(agent: AgentConfig, request: ActionRequest, reason: string): false {
    console.warn(`[live-action] ${agent.id}:${request.action} rejected: ${reason}`);
    this.eventBus.emit("action.result", {
      requestId: request.id,
      agentId: agent.id,
      action: request.action,
      ok: false,
      startedAt: request.createdAt,
      completedAt: new Date().toISOString(),
      error: reason,
      data: { status: "rejected" },
    });
    return false;
  }
}

function addRuntimeAgent(
  agent: AgentConfig,
  deps: {
    registry: AgentRegistry;
    scheduler: AgentScheduler;
    context: LiveContext;
    subteams: SubteamDirectory;
    actions: LiveSchedulerActions;
    competitive: CompetitiveLiveCoordinator;
    connectAgent?: (agent: AgentConfig) => Promise<void>;
  },
): void {
  if (!deps.registry.get(agent.id)) {
    deps.registry.register(agent);
  }
  deps.context.addAgent(agent);
  deps.subteams.addAgent(agent);
  deps.scheduler.addAgent(agent);
  deps.actions.addAgent(agent);
  deps.competitive.addAgent(agent);

  if (deps.connectAgent) {
    deps.connectAgent(agent).catch((error: unknown) => {
      deps.registry.markError(agent.id, formatError(error));
      console.error(`[live] add-agent ${agent.id} connection failed: ${formatError(error)}`);
    });
  }
}

function agentConfigFromPayload(value: JsonValue | undefined): AgentConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, JsonValue>;
  const account = source.account;
  if (!account || typeof account !== "object" || Array.isArray(account)) {
    return undefined;
  }
  const accountSource = account as Record<string, JsonValue>;
  const id = stringPayload(source.id);
  const name = stringPayload(source.name);
  const username = stringPayload(accountSource.username);
  const role = stringPayload(source.role);
  const providerRef = stringPayload(source.providerRef) ?? "deepseek";
  if (!id || !name || !username || !role) {
    return undefined;
  }
  return {
    id,
    name,
    account: {
      username,
      auth: accountSource.auth === "microsoft" ? "microsoft" : "offline",
    },
    role,
    team: stringPayload(source.team),
    subteam: stringPayload(source.subteam),
    leader: source.leader === true,
    mode: "routine",
    routine: stringPayload(source.routine),
    allowedActions: normalizeAgentActions(
      stringArrayPayload(source.allowedActions).length > 0
        ? stringArrayPayload(source.allowedActions)
        : [...DEFAULT_AGENT_ACTIONS],
    ),
    providerRef,
    visibility: "ai",
  };
}

function wakeEventsFromGameEvent(event: GameEvent, agents: AgentConfig[]): GameEvent[] {
  if (event.type === "ai_private_chat" || event.type === "human_team_chat") {
    return [asLeaderCommand(event, agents)];
  }
  if (event.type === "player_chat") {
    return isActionablePlayerChat(event) ? [asLeaderCommand(event, agents)] : [];
  }
  if (event.type === "player_damage") {
    return [{ ...event, type: "attacked" }];
  }
  if (event.type === "player_death") {
    return [{ ...event, type: "death" }];
  }
  return [event];
}

function asLeaderCommand(event: GameEvent, agents: AgentConfig[]): GameEvent {
  return {
    ...event,
    type: "chat.leader_command",
    payload: {
      ...event.payload,
      recipientIds: agents.map((agent) => agent.id),
      message: stringPayload(event.payload.content) ?? stringPayload(event.payload.message) ?? "",
      subteams: [...new Set(agents.map((agent) => agent.subteam ?? agent.team ?? "ai"))],
    },
  };
}

function emitAiSubteamBriefing(
  eventBus: StudioEventBus,
  subteams: SubteamDirectory,
  briefedTeamTasks: Set<string>,
  subteamId: string,
  task: string,
  topic: "leader-briefing" | "subteam-task",
): void {
  const normalizedTask = normalizeTaskText(task);
  if (!normalizedTask) return;

  const team = subteams.list().find((candidate) => candidate.id === subteamId);
  const senderId = team?.leaderId ?? team?.memberIds[0];
  if (!team || !senderId) return;

  const recipientIds = team.memberIds.filter((agentId) => agentId !== senderId);
  if (recipientIds.length === 0) return;

  const dedupeKey = `${subteamId}:${normalizedTask}`;
  if (briefedTeamTasks.has(dedupeKey)) return;
  briefedTeamTasks.add(dedupeKey);

  eventBus.emit("chat.message", {
    id: randomUUID(),
    senderId,
    recipientIds,
    topic,
    urgency: topic === "subteam-task" ? 4 : 3,
    visibility: "ai",
    content: briefingMessage(task, topic),
    timestamp: new Date().toISOString(),
  });
}

function briefingMessage(task: string, topic: "leader-briefing" | "subteam-task"): string {
  const label = topic === "subteam-task" ? "New subteam task" : "New goal";
  const brief = clampMessage(task).replace(/[.?!]\s*$/, "");
  return `${label}: ${brief}. Start with your roles and report blockers here.`;
}

function briefingTaskFromDirectorEvent(event: GameEvent): string | undefined {
  const content = stringPayload(event.payload.content) ?? stringPayload(event.payload.message);
  if (!content) return undefined;
  if (event.type === "chat.leader_command") return content;
  if (
    (event.type === "ai_private_chat" || event.type === "human_team_chat")
    && event.visibility !== "public"
    && isActionableInstructionText(content, stringPayload(event.payload.channel))
  ) {
    return content;
  }
  return undefined;
}

function briefingTaskFromDirectorChat(message: AiChatMessage): string | undefined {
  if (message.senderId.toLowerCase() !== "director" || message.visibility === "public") {
    return undefined;
  }
  return isActionableInstructionText(message.content, message.topic) ? message.content.trim() : undefined;
}

function subteamIdsForDirectorEvent(event: GameEvent, subteams: SubteamDirectory): string[] {
  const explicitSubteams = uniqueStrings([
    stringPayload(event.payload.subteamId),
    ...stringArrayPayload(event.payload.subteamIds),
    ...stringArrayPayload(event.payload.subteams),
  ]);
  if (explicitSubteams.length > 0) {
    return knownSubteamIds(explicitSubteams, subteams);
  }

  const agentIds = uniqueStrings([
    ...stringArrayPayload(event.payload.recipientIds),
    ...stringArrayPayload(event.payload.agentIds),
    ...stringArrayPayload(event.payload.mentionedAgentIds),
  ]);
  if (agentIds.length > 0) {
    return subteamIdsForAgentIds(agentIds, subteams);
  }

  return subteams.list().map((team) => team.id);
}

function subteamIdsForChatMessage(message: AiChatMessage, subteams: SubteamDirectory): string[] {
  if (message.recipientIds.length > 0) {
    return subteamIdsForAgentIds(message.recipientIds, subteams);
  }
  return subteams.list().map((team) => team.id);
}

function subteamIdsForAgentIds(agentIds: string[], subteams: SubteamDirectory): string[] {
  return uniqueStrings(agentIds.map((agentId) => subteams.teamForAgent(agentId)?.id));
}

function knownSubteamIds(subteamIds: string[], subteams: SubteamDirectory): string[] {
  const known = new Set(subteams.list().map((team) => team.id));
  return subteamIds.filter((subteamId) => known.has(subteamId));
}

function isActionableInstructionText(content: string, topic?: string): boolean {
  if (topic && /\b(task|goal|objective|scenario|brief|assignment|launch|mission)\b/i.test(topic)) {
    return true;
  }
  return /\b(follow|come|go|move|build|mine|collect|craft|attack|kill|hunt|guard|protect|help|retreat|stop|resume|start|find|scout|patrol|prepare|survive|win|wins|village|base|camp|house|objective|scenario|task)\b/i
    .test(content);
}

function chatFromGameEvent(event: GameEvent, agents: AgentConfig[]): AiChatMessage | undefined {
  const content = stringPayload(event.payload.content) ?? stringPayload(event.payload.message);
  if (!content || !isDirectorMessageEvent(event)) {
    return undefined;
  }
  return {
    id: event.id,
    senderId: event.actorId ?? "director",
    recipientIds: agents.map((agent) => agent.id),
    visibility: event.visibility,
    content,
    topic: stringPayload(event.payload.channel) ?? event.type,
    timestamp: event.timestamp,
  };
}

function isDirectorMessageEvent(event: GameEvent): boolean {
  return event.type === "ai_private_chat"
    || event.type === "human_team_chat"
    || (event.type === "player_chat" && isActionablePlayerChat(event))
    || event.type === "chat.leader_command";
}

function isActionablePlayerChat(event: GameEvent): boolean {
  const content = (stringPayload(event.payload.content) ?? stringPayload(event.payload.message) ?? "").trim();
  if (!content) return false;
  if (
    stringArrayPayload(event.payload.agentIds).length > 0
    || stringArrayPayload(event.payload.recipientIds).length > 0
    || stringArrayPayload(event.payload.mentionedAgentIds).length > 0
  ) {
    return true;
  }

  const normalized = content.toLowerCase();
  if (/^[!/]/.test(normalized)) return true;
  if (/^(help|come|follow|stop|run|retreat|attack|build|mine|guard|protect)\b/.test(normalized)) {
    return true;
  }
  return /\b(ai|agent|agents|bot|bots|team|subteam|leader|everyone)\b/.test(normalized)
    && /\b(follow|come|go|move|build|mine|collect|craft|attack|kill|hunt|guard|protect|help|retreat|stop|resume|start|find|scout)\b/.test(normalized);
}

function routinePerceptionFromBot(
  agentId: string,
  bot: BotHandle,
  recentEvents: GameEvent[],
  attackTargetUsername?: string,
  protectedUsernames: string[] = [],
): RoutinePerceptionSnapshot {
  const botSnapshot = createPerceptionSnapshot({ agentId, bot, recentEvents });
  const protectedPlayers = new Set(protectedUsernames.map((name) => name.toLowerCase()));
  const attackTarget = attackTargetUsername?.toLowerCase();
  return {
    agentId,
    health: bot.health ?? 20,
    inventory: routineInventory(botSnapshot),
    visibleBlocks: visibleBlocks(bot),
    nearbyEntities: [
      ...botSnapshot.nearbyMobs.map((entity) => ({
        id: entity.id,
        type: entity.name ?? entity.kind,
        position: entity.position,
        distance: entity.distance,
        hostile: entity.kind === "hostile",
      })),
      ...botSnapshot.nearbyItems.map((entity) => ({
        id: entity.id,
        type: entity.name ?? "item",
        position: entity.position,
        distance: entity.distance,
        hostile: false,
      })),
    ],
    nearbyPlayers: botSnapshot.nearbyPlayers.map((player) => ({
      id: player.id,
      name: player.username ?? player.name ?? player.id,
      distance: player.distance,
      protected: player.username
        ? protectedPlayers.has(player.username.toLowerCase()) && player.username.toLowerCase() !== attackTarget
        : false,
      threatening: player.username ? player.username.toLowerCase() === attackTarget : false,
    })),
    patrolPoints: patrolPoints(bot),
  };
}

function emptyRoutinePerception(agentId: string): RoutinePerceptionSnapshot {
  return {
    agentId,
    health: 20,
    inventory: { tools: [], seeds: 0 },
    visibleBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  };
}

function routineInventory(snapshot: BotPerceptionSnapshot): RoutinePerceptionSnapshot["inventory"] {
  return {
    tools: snapshot.inventory
      .filter((item) => /pickaxe|axe|shovel|hoe|sword/i.test(item.name))
      .map((item) => item.name),
    seeds: snapshot.inventory
      .filter((item) => /seed/i.test(item.name))
      .reduce((total, item) => total + item.count, 0),
    food: snapshot.inventory
      .filter((item) => /bread|apple|potato|carrot|beef|pork|chicken|mutton/i.test(item.name))
      .reduce((total, item) => total + item.count, 0),
  };
}

function visibleBlocks(bot: BotHandle): RoutinePerceptionSnapshot["visibleBlocks"] {
  const origin = bot.entity?.position;
  if (!origin || !bot.blockAt) {
    return [];
  }

  const blocks: RoutinePerceptionSnapshot["visibleBlocks"] = [];
  const ox = Math.floor(origin.x);
  const oy = Math.floor(origin.y);
  const oz = Math.floor(origin.z);
  for (let dx = -4; dx <= 4; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dz = -4; dz <= 4; dz += 1) {
        const position = { x: ox + dx, y: oy + dy, z: oz + dz, world: origin.world };
        const block = safeBlockAt(bot, position);
        if (!block || block.name === "air") continue;
        blocks.push({
          id: `${position.x},${position.y},${position.z}`,
          type: block.name,
          position: block.position,
          safe: true,
          belowAgent: dx === 0 && dz === 0 && dy < 0,
          mature: isMatureCrop(block),
          needsPlanting: false,
        });
        if (blocks.length >= 40) return blocks;
      }
    }
  }
  return blocks;
}

function safeBlockAt(bot: BotHandle, position: Position): BotBlock | null {
  try {
    return bot.blockAt?.(position) ?? null;
  } catch {
    return null;
  }
}

function isMatureCrop(block: BotBlock): boolean {
  const metadata = (block as unknown as { metadata?: number }).metadata;
  return /wheat|carrots|potatoes|beetroots/.test(block.name) && metadata === 7;
}

function patrolPoints(bot: BotHandle): Position[] {
  const position = bot.entity?.position;
  if (!position) return [];
  return [
    { x: position.x + 8, y: position.y, z: position.z, world: position.world },
    { x: position.x, y: position.y, z: position.z + 8, world: position.world },
  ];
}

function promptPerception(
  botSnapshot: BotPerceptionSnapshot | undefined,
  routineSnapshot: RoutinePerceptionSnapshot,
): PromptPerceptionSnapshot {
  return {
    ...botSnapshot,
    health: botSnapshot?.health ?? routineSnapshot.health,
    visibleBlocks: routineSnapshot.visibleBlocks.map((block) => compactRecord({
      id: block.id,
      type: block.type,
      position: block.position,
      mature: block.mature,
      safe: block.safe,
      belowAgent: block.belowAgent,
      needsPlanting: block.needsPlanting,
    })),
    nearbyEntities: routineSnapshot.nearbyEntities.map((entity) => compactRecord({
      id: entity.id,
      type: entity.type,
      position: entity.position,
      distance: entity.distance,
      hostile: entity.hostile,
      protected: entity.protected,
    })),
    nearbyPlayers: routineSnapshot.nearbyPlayers.map((player) => compactRecord({
      id: player.id,
      name: player.name,
      team: player.team,
      distance: player.distance,
      protected: player.protected,
      threatening: player.threatening,
    })),
    patrolPoints: routineSnapshot.patrolPoints,
  };
}

function personaForAgent(agent: AgentConfig, roleOverride?: string): StaticPersona {
  const activeRole = roleOverride ?? agent.role;
  const roleStyle: Record<string, string> = {
    farmer: "Practical, cooperative, focused on food, safety, and keeping the group supplied.",
    miner: "Direct, resource-driven, cautious underground, and proud of useful finds.",
    guard: "Alert, protective, concise, and quick to warn the group about danger.",
    leader: "Organized, calm, and focused on assigning clear work.",
    traitor: "Secretive, opportunistic, and careful to hide disloyal intent until the right moment.",
    jester: "Chaotic, playful, and eager to provoke reactions without losing the thread of the task.",
    maniac: "Impulsive, intense, and drawn toward risky direct action when the director allows it.",
    scientist: "Experimental, observant, and focused on testing systems, materials, and outcomes.",
    coder: "Analytical and protocol-minded, able to invent compact code words for team coordination.",
    spy: "Quiet, observant, and focused on gathering information without attracting attention.",
    scout: "Fast, concise, and focused on route finding, landmarks, and enemy positions.",
    builder: "Practical, spatial, and focused on turning materials into useful structures.",
    medic: "Protective, calm, and focused on food, retreat paths, and keeping teammates alive.",
    diplomat: "Careful with words, useful for negotiation, misdirection, and cross-team messages.",
    saboteur: "Patient, deceptive, and focused on disrupting opponents only when allowed by the scenario.",
  };
  return {
    identity: `${agent.name} is a Minecraft ${activeRole} on team ${agent.team ?? "ai"} subteam ${agent.subteam ?? "ai"}${agent.leader ? " and is the subteam leader" : ""}.`,
    background: roleStyle[activeRole.toLowerCase()] ?? `Acts according to the ${activeRole} role.`,
    speakingStyle: "Short in-character Minecraft chat, one sentence when possible.",
    values: ["team survival", "useful progress", "clear communication"],
    boundaries: ["avoid griefing", "avoid friendly fire", "do not reveal hidden reasoning"],
  };
}

function availableLiveActions(agent: AgentConfig, bot: BotHandle | undefined): AgentDecision["action"][] {
  const actions = new Set(allowedDecisionActionsForAgent(agent));
  if (!bot?.pathfinder) {
    actions.delete("move_to");
    actions.delete("follow_player");
    actions.delete("flee");
  }
  if (!bot?.collectBlock) actions.delete("collect_item");
  if (!bot?.blockAt || !bot.dig) actions.delete("mine_block");
  if (!bot?.craft || !bot.recipesFor) actions.delete("craft_item");
  if (!bot?.blockAt || !bot.placeBlock || !bot.equip) actions.delete("place_block");
  if (!bot?.attack) actions.delete("attack_entity");
  return [...actions];
}

function threatLevel(perception: RoutinePerceptionSnapshot): "none" | "low" | "medium" | "high" {
  if (perception.health <= 6) return "high";
  if (perception.nearbyEntities.some((entity) => entity.hostile)) return perception.health <= 10 ? "high" : "medium";
  return "none";
}

function isSelfUsername(agent: AgentConfig, username: string | undefined): boolean {
  return Boolean(username && username.toLowerCase() === agent.account.username.toLowerCase());
}

function isTeamMovementGoal(goal: string): boolean {
  return /\b(follow|leader|go|move|find|scout|build|village|base|camp|house|kill|attack|hunt)\b/i.test(goal);
}

function isCompetitiveObjective(goal: string | undefined): boolean {
  if (!goal) return false;
  const hasVillageOrCompetition = /\b(competitive|compete|first team|specified village|village)\b/i.test(goal);
  const hasPlayerKillObjective = /\b(hunt|kill(?:s|ed|ing)?|killing blow|human player|player)\b/i.test(goal);
  const hasTournamentKillWinCondition =
    /\b(team|whoever|whichever|whatever|first)\b[\s\S]{0,80}\b(kill(?:s|ed|ing)?|slay(?:s|ed|ing)?|eliminate(?:s|d|ing)?)\b[\s\S]{0,80}\b(wins?|victory)\b/i.test(goal)
    || /\b(kill(?:s|ed|ing)?|slay(?:s|ed|ing)?|eliminate(?:s|d|ing)?)\b[\s\S]{0,40}\b(me|my player|human player)\b[\s\S]{0,80}\b(wins?|victory)\b/i.test(goal);

  return (hasVillageOrCompetition && hasPlayerKillObjective) || hasTournamentKillWinCondition;
}

function isAttackGoal(goal: string): boolean {
  return /\b(kill|attack|hunt|eliminate)\b/i.test(goal);
}

function positionDistance(
  left: Pick<Position, "x" | "y" | "z"> | undefined,
  right: Pick<Position, "x" | "y" | "z"> | undefined,
): number {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isAutonomousCollectTarget(
  entity: RoutinePerceptionSnapshot["nearbyEntities"][number],
  current: Position | undefined,
): boolean {
  if (!entity.id || entity.hostile === true || !entity.position) {
    return false;
  }
  return Boolean(entity.id)
    && isSpecificUsefulDropType(entity.type)
    && (!current || positionDistance(current, entity.position) <= MAX_AUTONOMOUS_COLLECT_DISTANCE);
}

function isSpecificUsefulDropType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized !== "item"
    && normalized !== "object"
    && normalized !== "dropped_item"
    && USEFUL_DROP_PATTERN.test(normalized);
}

function nearbyBuildPosition(bot: BotHandle | undefined): Position | undefined {
  const current = toPosition(bot?.entity?.position);
  if (!current || !bot?.blockAt) {
    return undefined;
  }
  const base = {
    x: Math.floor(current.x),
    y: Math.floor(current.y),
    z: Math.floor(current.z),
    world: current.world,
  };
  const candidates = [
    { x: base.x + 1, y: base.y, z: base.z, world: base.world },
    { x: base.x, y: base.y, z: base.z + 1, world: base.world },
    { x: base.x - 1, y: base.y, z: base.z, world: base.world },
    { x: base.x, y: base.y, z: base.z - 1, world: base.world },
  ];
  return candidates.find((candidate) => {
    const target = bot.blockAt?.(candidate);
    const below = bot.blockAt?.({ ...candidate, y: candidate.y - 1 });
    return (!target || target.name === "air") && Boolean(below && below.name !== "air");
  });
}

function hasPlaceableInventory(bot: BotHandle | undefined): boolean {
  return Boolean(bot?.inventory?.items().some((item) =>
    /dirt|cobblestone|stone|planks|log|wood|brick|sand|gravel|glass/i.test(item.name),
  ));
}

function idleIntent(reason: string): RoutineActionIntent {
  return {
    action: "idle",
    params: { durationMs: 1_000, reason },
    timeoutMs: 2_000,
    requestedBy: "live-runtime",
  };
}

function logSchedulerEvent(event: SchedulerEvent): void {
  if (event.type === "scheduler.planning.started") {
    console.log(`[live] ${event.type} ${event.agentId}`);
    return;
  }
  if (
    event.type === "scheduler.action.started"
    || event.type === "scheduler.action.queued"
    || event.type === "scheduler.action.finished"
    || event.type === "scheduler.action.canceled"
    || event.type === "scheduler.action.rejected"
  ) {
    const action = typeof event.payload.action === "string" ? event.payload.action : "unknown";
    const ok = typeof event.payload.ok === "boolean" ? ` ok=${event.payload.ok}` : "";
    const reason = typeof event.payload.reason === "string" ? ` reason=${event.payload.reason}` : "";
    console.log(`[live] ${event.type} ${event.agentId}:${action}${ok}${reason}`);
  }
}

function emitSchedulerTraceEvent(eventBus: StudioEventBus, event: SchedulerEvent): void {
  const payload = event.type === "routine.task"
    ? compactRecord({
        ...event.payload,
        routineId: event.routineId,
        status: event.status,
        message: event.message,
      })
    : event.payload;

  eventBus.emit("game.event", {
    id: randomUUID(),
    type: event.type,
    actorId: event.agentId,
    severity: event.severity,
    visibility: "ai",
    payload,
    timestamp: new Date().toISOString(),
  });
}

function speechContent(decision: AgentDecision): string | undefined {
  return decision.speech?.content;
}

function eventText(event: GameEvent): string {
  return stringPayload(event.payload.content)
    ?? stringPayload(event.payload.message)
    ?? event.type;
}

function clampMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length <= 220 ? trimmed : `${trimmed.slice(0, 217)}...`;
}

function logLlmDecisionTrace(agent: AgentConfig, result: AgentDecisionServiceResult): void {
  if (!decisionTraceEnabled()) {
    return;
  }

  const usage = formatLlmUsage(result.usage);
  const fallbackReason = result.fallbackReason
    ? ` fallbackReason=${JSON.stringify(redactLogText(result.fallbackReason))}`
    : "";
  const rejection = result.rejection
    ? ` rejection=${result.rejection.code}:${result.rejection.path ?? "decision"}`
    : "";
  console.log(
    `[llm-decision] agent=${agent.id} provider=${result.request.provider} model=${result.request.model}`
      + ` fallback=${result.fallback} action=${result.decision.action}`
      + ` confidence=${result.decision.confidence.toFixed(2)}`
      + `${usage ? ` ${usage}` : ""}`
      + fallbackReason
      + rejection,
  );
  console.log(
    `[llm-decision] agent=${agent.id} params=${safeJson(result.decision.parameters)}`
      + ` reasoning=${JSON.stringify(clampMessage(redactLogText(result.decision.reasoningSummary)))}`
      + `${result.decision.speech ? ` speech=${safeJson(result.decision.speech)}` : ""}`,
  );
}

function decisionTraceEnabled(): boolean {
  return truthyEnv("LIVE_LLM_DEBUG") || truthyEnv("LIVE_DECISION_TRACE");
}

function truthyEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function formatLlmUsage(usage: AgentDecisionServiceResult["usage"]): string {
  if (!usage) {
    return "";
  }
  const parts = [
    usage.inputTokens !== undefined ? `input=${usage.inputTokens}` : undefined,
    usage.outputTokens !== undefined ? `output=${usage.outputTokens}` : undefined,
    usage.cacheHitInputTokens !== undefined ? `cacheHit=${usage.cacheHitInputTokens}` : undefined,
    usage.cacheMissInputTokens !== undefined ? `cacheMiss=${usage.cacheMissInputTokens}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `usage(${parts.join(" ")})` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "\"[unserializable]\"";
  }
}

function redactLogText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ds)-[A-Za-z0-9._~+/=-]{12,}\b/g, "[redacted-key]");
}

function toPosition(position: BotEntity["position"] | undefined): Position | undefined {
  if (!position) return undefined;
  return { x: position.x, y: position.y, z: position.z, world: position.world };
}

function stringPayload(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayPayload(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeTaskText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayParam(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  return values.length > 0 ? values : undefined;
}

function compactRecord(source: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function jsonParams(source: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, JsonValue] => isJsonValue(entry[1])),
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function seededRandom(seedText: string): () => number {
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
  }
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function trim<T>(values: T[], max: number): void {
  while (values.length > max) values.shift();
}

function pushLimited(
  map: Map<string, string[]>,
  key: string,
  value: string,
  max: number,
): void {
  const values = map.get(key) ?? [];
  values.push(value);
  trim(values, max);
  map.set(key, values);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
