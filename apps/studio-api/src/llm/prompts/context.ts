import type { AiChatMessage, GameEvent, JsonValue, Position } from "@mc-ai-video/contracts";

import { joinBudgetedSections, type PromptSection } from "./budget";
import type {
  ActiveScenarioContext,
  DynamicAgentState,
  MemoryContext,
  PromptContext,
  PromptContextInput,
  PromptPerceptionSnapshot,
  RelationshipContext,
  StaticPersona,
} from "./types";

const DEFAULT_MAX_CONTEXT_CHARS = 6_000;

export function buildPromptContext(input: PromptContextInput): PromptContext {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const staticPersonaText = renderStaticPersona(input.staticPersona);
  const dynamicStateText = renderDynamicState(input.dynamicState);
  const sections: PromptSection[] = [
    {
      title: "STATIC_PERSONA",
      body: staticPersonaText,
      required: true,
    },
    {
      title: "DYNAMIC_STATE",
      body: dynamicStateText,
      required: true,
    },
    {
      title: "AGENT",
      body: lines([
        `id=${input.agent.id}`,
        `name=${input.agent.name}`,
        `role=${input.agent.role}`,
        input.agent.team ? `team=${input.agent.team}` : undefined,
        input.agent.routine ? `routine=${input.agent.routine}` : undefined,
      ]),
      required: true,
    },
    {
      title: "PERCEPTION",
      body: renderPerception(input.perception),
    },
    {
      title: "SCENARIO",
      body: renderScenario(input.activeScenario),
    },
    {
      title: "RELATIONSHIPS",
      body: renderRelationships(input.relationships),
    },
    {
      title: "MEMORIES",
      body: renderMemories(input.memories),
    },
    {
      title: "RECENT_CHAT",
      body: renderRecentChat(input.recentChat),
    },
    {
      title: "RECENT_EVENTS",
      body: renderRecentEvents(input.recentEvents),
    },
  ].filter((section) => section.body.trim().length > 0);

  const budgeted = joinBudgetedSections(sections, maxChars);
  return {
    agentId: input.agent.id,
    maxChars,
    staticPersonaText,
    dynamicStateText,
    contextText: budgeted.text,
    truncated: budgeted.truncated,
  };
}

export function renderStaticPersona(persona: StaticPersona): string {
  return lines([
    `identity=${persona.identity}`,
    persona.background ? `background=${persona.background}` : undefined,
    persona.speakingStyle ? `speakingStyle=${persona.speakingStyle}` : undefined,
    persona.values?.length ? `values=${persona.values.join(", ")}` : undefined,
    persona.boundaries?.length ? `boundaries=${persona.boundaries.join(", ")}` : undefined,
  ]);
}

export function renderDynamicState(state: DynamicAgentState | undefined): string {
  if (!state) {
    return "No dynamic state provided.";
  }
  return lines([
    state.mode ? `mode=${state.mode}` : undefined,
    state.health !== undefined ? `health=${state.health}` : undefined,
    state.food !== undefined ? `food=${state.food}` : undefined,
    state.position ? `position=${renderPosition(state.position)}` : undefined,
    state.activeGoal ? `activeGoal=${state.activeGoal}` : undefined,
    state.currentRoutine ? `currentRoutine=${state.currentRoutine}` : undefined,
    state.currentTask ? `currentTask=${state.currentTask}` : undefined,
    state.emotionalState ? `emotionalState=${state.emotionalState}` : undefined,
    state.threatLevel ? `threatLevel=${state.threatLevel}` : undefined,
  ]) || "No dynamic state provided.";
}

function renderPerception(perception: PromptPerceptionSnapshot | undefined): string {
  if (!perception) {
    return "";
  }
  return lines([
    perception.timestamp ? `timestamp=${perception.timestamp}` : undefined,
    perception.health !== undefined ? `health=${perception.health}` : undefined,
    perception.food !== undefined ? `food=${perception.food}` : undefined,
    perception.position ? `position=${renderPosition(perception.position)}` : undefined,
    renderList("inventory", compactValues(perception.inventory, 8)),
    renderList("nearbyPlayers", compactValues(perception.nearbyPlayers, 8)),
    renderList("nearbyMobs", compactValues(perception.nearbyMobs, 8)),
    renderList("nearbyItems", compactValues(perception.nearbyItems, 8)),
    renderList("visibleBlocks", compactValues(perception.visibleBlocks, 10)),
    renderList("nearbyEntities", compactValues(perception.nearbyEntities, 8)),
    renderList("patrolPoints", compactValues(perception.patrolPoints, 6)),
  ]);
}

function renderScenario(context: ActiveScenarioContext | undefined): string {
  if (!context) {
    return "";
  }
  const scenario = context.scenario;
  return lines([
    `id=${scenario.id}`,
    scenario.name ? `name=${scenario.name}` : undefined,
    context.currentEpisodeGoal ? `episodeGoal=${context.currentEpisodeGoal}` : undefined,
    renderList("teams", scenario.teams.map((team) => `${team.id}:${team.agentIds.join("|")}`).slice(0, 8)),
    renderList("roles", scenario.roles.map((role) => `${role.agentId}:${role.role}${role.team ? `/${role.team}` : ""}`).slice(0, 12)),
    renderList("startingGoals", scenario.startingGoals.map((goal) => `${goal.agentId}:${goal.goal}`).slice(0, 8)),
    renderList("directorConstraints", context.directorConstraints ?? []),
    renderList("visibleSecretRoles", context.visibleSecretRoles ?? []),
  ]);
}

function renderRelationships(relationships: RelationshipContext[] | undefined): string {
  return renderList(
    "relationships",
    (relationships ?? []).slice(0, 12).map((relationship) => {
      const name = relationship.name ? `${relationship.name} ` : "";
      const scores = [
        relationship.trust !== undefined ? `trust=${relationship.trust}` : undefined,
        relationship.loyalty !== undefined ? `loyalty=${relationship.loyalty}` : undefined,
        relationship.fear !== undefined ? `fear=${relationship.fear}` : undefined,
      ].filter(Boolean).join(" ");
      const tags = relationship.tags?.length ? ` tags=${relationship.tags.join("|")}` : "";
      return `${relationship.agentId}:${name}${scores}${tags}`.trim();
    }),
  ) ?? "";
}

function renderMemories(memories: MemoryContext[] | undefined): string {
  const ordered = [...(memories ?? [])].sort((a, b) =>
    (b.importance ?? 0) - (a.importance ?? 0)
    || (b.timestamp ?? "").localeCompare(a.timestamp ?? "")
    || (a.id ?? a.summary).localeCompare(b.id ?? b.summary),
  );
  return renderList(
    "memories",
    ordered.slice(0, 10).map((memory) => {
      const importance = memory.importance !== undefined ? ` importance=${memory.importance}` : "";
      const related = memory.relatedAgentIds?.length ? ` related=${memory.relatedAgentIds.join("|")}` : "";
      return `${memory.summary}${importance}${related}`;
    }),
  ) ?? "";
}

function renderRecentChat(messages: AiChatMessage[] | undefined): string {
  return renderList(
    "recentChat",
    (messages ?? []).slice(-8).map((message) =>
      `${message.timestamp} ${message.senderId}->${message.recipientIds.join("|") || message.visibility}: ${message.content}`,
    ),
  ) ?? "";
}

function renderRecentEvents(events: GameEvent[] | undefined): string {
  return renderList(
    "recentEvents",
    (events ?? []).slice(-8).map((event) =>
      `${event.timestamp} sev=${event.severity} type=${event.type} actor=${event.actorId ?? "unknown"} target=${event.targetId ?? "none"}`,
    ),
  ) ?? "";
}

function compactValues(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.slice(0, maxItems).map((value) => compactValue(value));
}

function compactValue(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }
  const record = value as Record<string, JsonValue | undefined>;
  const fields = [
    record.id,
    record.name,
    record.username,
    record.type,
    record.kind,
    record.count !== undefined ? `x${record.count}` : undefined,
    record.distance !== undefined ? `d=${record.distance}` : undefined,
    record.position ? renderPosition(record.position as Position) : undefined,
    record.hostile === true ? "hostile" : undefined,
    record.threatening === true ? "threatening" : undefined,
  ].filter(Boolean);
  return fields.join("/");
}

function renderList(label: string, values: string[]): string | undefined {
  return values.length ? `${label}=${values.join("; ")}` : undefined;
}

function renderPosition(position: Position): string {
  return `${round(position.x)},${round(position.y)},${round(position.z)}${position.world ? `@${position.world}` : ""}`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function lines(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join("\n");
}
