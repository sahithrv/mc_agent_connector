import type { AiChatMessage, GameEvent, JsonValue, Position } from "@mc-ai-video/contracts";

import { joinBudgetedSections, type PromptSection } from "./budget";
import type {
  ActiveScenarioContext,
  ActionResultContext,
  DynamicAgentState,
  MemoryContext,
  PromptActionAffordance,
  PromptContext,
  PromptContextInput,
  PromptPlanStep,
  PromptPerceptionSnapshot,
  PromptRecoveryContext,
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
      title: "RECOVERY",
      body: renderRecovery(input.recovery),
    },
    {
      title: "CURRENT_PLAN",
      body: renderTaskState(input.taskState),
    },
    {
      title: "AGENT",
      body: lines([
        `id=${input.agent.id}`,
        `name=${input.agent.name}`,
        `role=${input.agent.role}`,
        input.agent.team ? `team=${input.agent.team}` : undefined,
        input.agent.subteam ? `subteam=${input.agent.subteam}` : undefined,
        input.agent.leader === true ? "subteamLeader=true" : undefined,
        input.agent.routine ? `routine=${input.agent.routine}` : undefined,
      ]),
      required: true,
    },
    {
      title: "PERCEPTION",
      body: renderPerception(input.perception),
    },
    {
      title: "EXECUTABLE_NOW",
      body: renderExecutableAffordances(input.affordances),
    },
    {
      title: "BLOCKED_USEFUL_ACTIONS",
      body: renderBlockedAffordances(input.affordances),
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
      title: "RECENT_ACTION_RESULTS",
      body: renderRecentActionResults(input.recentActionResults),
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

function renderRecentActionResults(results: ActionResultContext[] | undefined): string {
  return renderLines(
    (results ?? []).slice(-8).map((result) => {
      const fields = [
        result.action,
        `target=${actionResultTarget(result)}`,
        `ok=${result.ok}`,
        result.error ? `error=${JSON.stringify(result.error)}` : undefined,
        result.requestedBy ? `requestedBy=${result.requestedBy}` : undefined,
        result.completedAt ? `completedAt=${result.completedAt}` : undefined,
        result.data ? `data=${compactData(result.data)}` : undefined,
      ];
      return fields.filter((field): field is string => Boolean(field)).join(" ");
    }),
  );
}

function renderRecovery(recovery: PromptRecoveryContext | undefined): string {
  if (!recovery || (!recovery.stuck && !recovery.blockedTargetKeys?.length && !recovery.hint)) {
    return "";
  }
  return lines([
    `stuck=${recovery.stuck}`,
    recovery.reason ? `reason=${recovery.reason}` : undefined,
    recovery.blockedTargetKeys?.length ? `blockedTargetKeys=${recovery.blockedTargetKeys.join(", ")}` : undefined,
    recovery.hint ? `hint=${recovery.hint}` : undefined,
    "constraint=choose a different action/target or satisfy the blocker before retrying",
  ]);
}

function renderTaskState(taskState: PromptContextInput["taskState"]): string {
  if (!taskState) {
    return "";
  }
  const header = lines([
    taskState.goal ? `goal=${taskState.goal}` : undefined,
    taskState.currentStepId ? `currentStep=${taskState.currentStepId}` : undefined,
    `updatedAt=${taskState.updatedAt}`,
  ]);
  const steps = renderLines(
    taskState.plan.map((step) => renderPlanStep(step)),
  );
  return [header, steps || "plan=not generated yet"].filter(Boolean).join("\n");
}

function renderPlanStep(step: PromptPlanStep): string {
  const parts = [
    `[${step.status}]`,
    `${step.id}: ${step.description}`,
    step.nextAction ? `nextAction=${step.nextAction}` : undefined,
    step.skill ? `skill=${step.skill}` : undefined,
    step.successCondition ? `success=${JSON.stringify(step.successCondition)}` : undefined,
    step.neededItems ? `needs=${compactNeededItems(step.neededItems)}` : undefined,
    step.target !== undefined ? `target=${compactDataValue(step.target)}` : undefined,
    step.blocker ? `blocker=${JSON.stringify(step.blocker)}` : undefined,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function compactNeededItems(items: Record<string, number>): string {
  return Object.entries(items)
    .slice(0, 5)
    .map(([item, count]) => `${item}x${count}`)
    .join(",");
}

function renderExecutableAffordances(affordances: PromptActionAffordance[] | undefined): string {
  return renderLines(
    orderedAffordances(affordances, false)
      .slice(0, 10)
      .map((affordance) =>
        `${affordance.action} ${renderAffordanceTarget(affordance)} score=${formatScore(affordance.score)} reason=${JSON.stringify(affordance.reason)}`.trim(),
      ),
  );
}

function renderBlockedAffordances(affordances: PromptActionAffordance[] | undefined): string {
  return renderLines(
    orderedAffordances(affordances, true)
      .slice(0, 8)
      .map((affordance) =>
        `${affordance.action} ${renderAffordanceTarget(affordance)} blocked=${JSON.stringify(affordance.blockedReason ?? "blocked")}`.trim(),
      ),
  );
}

function orderedAffordances(
  affordances: PromptActionAffordance[] | undefined,
  blocked: boolean,
): PromptActionAffordance[] {
  return [...(affordances ?? [])]
    .filter((affordance) => Boolean(affordance.blocked) === blocked)
    .sort((left, right) =>
      Number(right.advancesGoal ?? false) - Number(left.advancesGoal ?? false)
      || right.score - left.score
      || left.action.localeCompare(right.action)
      || renderAffordanceTarget(left).localeCompare(renderAffordanceTarget(right)),
    );
}

function renderAffordanceTarget(affordance: PromptActionAffordance): string {
  const params = affordance.params;
  switch (affordance.action) {
    case "craft_item": {
      const item = firstString([params.item, params.name, params.block]) ?? "item";
      const count = numericParam(params.count);
      return count ? `${item} x${count}` : item;
    }
    case "mine_block": {
      const block = firstString([params.block, params.name]) ?? "block";
      const position = positionFromValue(params.position);
      return position ? `${block} at ${renderPosition(position)}` : block;
    }
    case "move_to": {
      const position = positionFromValue(params.position) ?? positionFromParams(params);
      return position ? renderPosition(position) : "target";
    }
    case "place_block": {
      const block = firstString([params.block, params.item, params.name]);
      const position = positionFromValue(params.position) ?? positionFromParams(params);
      return [block, position ? `at ${renderPosition(position)}` : undefined].filter(Boolean).join(" ") || "target";
    }
    case "follow_player":
      return firstString([params.username, params.player, params.target]) ?? "player";
    case "collect_item":
      return firstString([params.item, params.name, params.entityId]) ?? "item";
    case "attack_entity":
      return firstString([params.username, params.name, params.target, params.entityId]) ?? "entity";
    case "flee":
      return firstString([params.username, params.target, params.entityId]) ?? renderOptionalPosition(params) ?? "threat";
    default:
      return affordance.targetKey ? readableTargetKey(affordance.targetKey) : "";
  }
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

function renderLines(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "";
}

function actionResultTarget(result: ActionResultContext): string {
  const params = result.params ?? {};
  const position = positionFromValue(params.position);
  const primary = firstString([
    params.block,
    params.item,
    params.name,
    params.username,
    params.player,
    params.target,
    params.entityId,
  ]);
  if (primary && position) return `${primary}@${renderPosition(position)}`;
  if (primary) return primary;
  if (position) return renderPosition(position);
  if (result.targetKey) return readableTargetKey(result.targetKey);
  return "unknown";
}

function readableTargetKey(targetKey: string): string {
  const [prefix, ...rest] = targetKey.split(":");
  const value = rest.join(":");
  return value && prefix ? value : targetKey;
}

function firstString(values: Array<JsonValue | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function numericParam(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positionFromValue(value: JsonValue | undefined): Position | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<Position>;
  return typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number"
    ? { x: record.x, y: record.y, z: record.z, world: record.world }
    : undefined;
}

function positionFromParams(params: Record<string, JsonValue>): Position | undefined {
  return typeof params.x === "number" && typeof params.y === "number" && typeof params.z === "number"
    ? { x: params.x, y: params.y, z: params.z }
    : undefined;
}

function renderOptionalPosition(params: Record<string, JsonValue>): string | undefined {
  const position = positionFromValue(params.position) ?? positionFromParams(params);
  return position ? renderPosition(position) : undefined;
}

function compactData(data: Record<string, JsonValue>): string {
  const entries = Object.entries(data).slice(0, 4);
  return entries.map(([key, value]) => `${key}=${compactDataValue(value)}`).join(",");
}

function compactDataValue(value: JsonValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return Array.isArray(value) ? `[${value.length}]` : "{...}";
}

function renderPosition(position: Position): string {
  return `${round(position.x)},${round(position.y)},${round(position.z)}${position.world ? `@${position.world}` : ""}`;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatScore(value: number): string {
  return Math.max(0, Math.min(1, value)).toFixed(2);
}

function lines(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join("\n");
}
