import { Badge, Box, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import type { GameEvent } from "@mc-ai-video/contracts";
import { AlertTriangle, BrainCircuit, CircleGauge, Hourglass } from "lucide-react";

import { useStudioStore } from "../../lib/state/store";
import type { UiAgentRuntime, UiHealthSnapshot } from "../../lib/types";
import {
  DebugPanelFrame,
  EmptyPanelState,
  cellStyle,
  formatClock,
  monoStyle,
} from "./panelPrimitives";
import type { LlmQueueSnapshot, ProviderErrorView, RateLimitView } from "./types";

export interface LlmQueuePanelProps {
  agents?: UiAgentRuntime[];
  snapshot?: LlmQueueSnapshot;
}

export function LlmQueuePanel({ agents, snapshot }: LlmQueuePanelProps): JSX.Element {
  const storeAgents = useStudioStore((state) => state.agents);
  const health = useStudioStore((state) => state.health);
  const events = useStudioStore((state) => state.events);
  const sourceAgents = agents ?? storeAgents;
  const active = agentsByIds(sourceAgents, snapshot?.activeAgentIds, (agent) => agent.mode === "planning");
  const queued = agentsByIds(sourceAgents, snapshot?.queuedAgentIds, hasQueuedPlanner);
  const providerErrors = snapshot?.providerErrors ?? providerErrorsFromEvents(events, sourceAgents);
  const rateLimits = snapshot?.rateLimits ?? rateLimitFromHealth(health);
  const maxConcurrency = snapshot?.maxConcurrency ?? health.llmQueue.active + health.llmQueue.queued;

  return (
    <DebugPanelFrame
      icon={<BrainCircuit size={14} aria-hidden="true" />}
      meta="F26"
      rightSection={<QueueBadge active={active.length} queued={queued.length} />}
      subtitle="Planner slots, waiting agents, provider pressure"
      title="LLM queue"
    >
      <Stack gap="xs">
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
          <QueueMetric label="Active" tone="active" value={active.length} />
          <QueueMetric label="Queued" tone="queued" value={queued.length} />
          <QueueMetric label="Errors" tone={providerErrors.length > 0 ? "error" : "idle"} value={providerErrors.length} />
          <QueueMetric label="Slots" tone="idle" value={maxConcurrency || "n/a"} />
        </SimpleGrid>
        {active.length === 0 && queued.length === 0 && providerErrors.length === 0 ? (
          <EmptyPanelState
            detail="No planning agents, queue pressure, or provider errors have been reported yet."
            icon={<BrainCircuit size={16} aria-hidden="true" />}
            title="LLM queue is quiet"
          />
        ) : null}
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xs">
          <AgentQueueList
            empty="No active planner calls."
            icon={<CircleGauge size={14} aria-hidden="true" />}
            rows={active}
            title="Active planning agents"
          />
          <AgentQueueList
            empty="No agents waiting for a planning slot."
            icon={<Hourglass size={14} aria-hidden="true" />}
            rows={queued}
            title="Queued agents"
          />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xs">
          <ProviderErrors errors={providerErrors} />
          <RateLimitState limits={rateLimits} />
        </SimpleGrid>
      </Stack>
    </DebugPanelFrame>
  );
}

function QueueBadge(props: { active: number; queued: number }): JSX.Element {
  return (
    <Badge color={props.queued > 0 ? "yellow" : "lime"} radius="xs" size="xs" variant="light">
      {props.active} active / {props.queued} queued
    </Badge>
  );
}

function QueueMetric(props: {
  label: string;
  value: number | string;
  tone: "active" | "queued" | "error" | "idle";
}): JSX.Element {
  const color = props.tone === "error" ? "var(--mcas-red)" : props.tone === "queued" ? "var(--mcas-amber)" : "var(--mcas-green)";
  return (
    <Box style={cellStyle}>
      <Text c="dimmed" size="xs" tt="uppercase">
        {props.label}
      </Text>
      <Text fw={800} mt={2} size="lg" style={{ ...monoStyle, color }}>
        {props.value}
      </Text>
    </Box>
  );
}

function AgentQueueList(props: { title: string; icon: JSX.Element; empty: string; rows: UiAgentRuntime[] }): JSX.Element {
  return (
    <Box style={cellStyle}>
      <Group gap="xs" mb={6}>
        {props.icon}
        <Text fw={750} size="xs">
          {props.title}
        </Text>
      </Group>
      {props.rows.length === 0 ? (
        <Text c="dimmed" size="xs">
          {props.empty}
        </Text>
      ) : (
        <Stack gap={6}>
          {props.rows.map((agent) => (
            <Group key={agent.id} gap={6} justify="space-between" wrap="nowrap">
              <Box miw={0}>
                <Text fw={700} size="xs" truncate>
                  {agent.name}
                </Text>
                <Text c="dimmed" size="xs" style={monoStyle} truncate>
                  {agent.providerRef} / {agent.currentTask ?? agent.role}
                </Text>
              </Box>
              <Badge color={agent.mode === "planning" ? "lime" : "yellow"} radius="xs" size="xs" variant="outline">
                {agent.mode}
              </Badge>
            </Group>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function ProviderErrors({ errors }: { errors: ProviderErrorView[] }): JSX.Element {
  return (
    <Box style={cellStyle}>
      <Group gap="xs" mb={6}>
        <AlertTriangle size={14} aria-hidden="true" />
        <Text fw={750} size="xs">
          Provider errors
        </Text>
      </Group>
      {errors.length === 0 ? (
        <Text c="dimmed" size="xs">
          No recent provider errors.
        </Text>
      ) : (
        <Stack gap={6}>
          {errors.slice(0, 5).map((error, index) => (
            <Box key={error.id ?? `${error.agentId ?? "provider"}:${index}`}>
              <Group gap={6} justify="space-between" wrap="nowrap">
                <Text c="var(--mcas-red)" fw={700} size="xs" truncate>
                  {error.providerRef ?? error.agentId ?? "provider"}
                </Text>
                <Text c="dimmed" size="xs" style={monoStyle}>
                  {formatClock(error.timestamp)}
                </Text>
              </Group>
              <Text c="dimmed" size="xs" truncate title={error.message}>
                {error.message}
              </Text>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function RateLimitState({ limits }: { limits: RateLimitView[] }): JSX.Element {
  return (
    <Box style={cellStyle}>
      <Group gap="xs" mb={6}>
        <CircleGauge size={14} aria-hidden="true" />
        <Text fw={750} size="xs">
          Rate limits
        </Text>
      </Group>
      {limits.length === 0 ? (
        <Text c="dimmed" size="xs">
          No rate-limit telemetry.
        </Text>
      ) : (
        <Stack gap={6}>
          {limits.map((limit, index) => (
            <Group key={limit.providerRef ?? index} gap={6} justify="space-between" wrap="nowrap">
              <Box miw={0}>
                <Text fw={700} size="xs" truncate>
                  {limit.providerRef ?? "global"}
                </Text>
                <Text c="dimmed" size="xs" truncate>
                  {limit.message ?? (limit.limited ? "limited" : "clear")}
                </Text>
              </Box>
              <Badge color={limit.limited ? "red" : "lime"} radius="xs" size="xs" variant="light">
                {limit.remaining ?? "?"}/{limit.limit ?? "?"}
              </Badge>
            </Group>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function agentsByIds(
  agents: UiAgentRuntime[],
  ids: string[] | undefined,
  fallback: (agent: UiAgentRuntime) => boolean,
): UiAgentRuntime[] {
  if (!ids) return agents.filter(fallback);
  const idSet = new Set(ids);
  return agents.filter((agent) => idSet.has(agent.id));
}

function hasQueuedPlanner(agent: UiAgentRuntime): boolean {
  return agent.health?.planningQueued === true || agent.health?.llmQueued === true;
}

function providerErrorsFromEvents(events: GameEvent[], agents: UiAgentRuntime[]): ProviderErrorView[] {
  return events
    .filter((event) => event.type === "scheduler.planning.finished" && typeof event.payload.error === "string")
    .slice(0, 5)
    .map((event) => {
      const agent = agents.find((candidate) => candidate.id === event.actorId);
      return {
        agentId: event.actorId,
        providerRef: agent?.providerRef,
        message: String(event.payload.error),
        timestamp: event.timestamp,
      };
    });
}

function rateLimitFromHealth(health: UiHealthSnapshot): RateLimitView[] {
  if (health.llmQueue.status === "unknown" && !health.llmQueue.message) return [];
  return [
    {
      providerRef: "queue",
      limited: health.llmQueue.status === "degraded" || health.llmQueue.status === "offline",
      remaining: health.llmQueue.active,
      limit: Math.max(health.llmQueue.active + health.llmQueue.queued, health.llmQueue.active),
      message: health.llmQueue.message,
    },
  ];
}
