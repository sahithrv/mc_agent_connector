import { Badge, Box, Code, Group, Stack, Table, Text } from "@mantine/core";
import { ListChecks, TimerReset, TriangleAlert } from "lucide-react";
import type { ActionRequest, ActionResult, GameEvent } from "@mc-ai-video/contracts";

import { useStudioStore } from "../../lib/state/store";
import type { UiAgentRuntime } from "../../lib/types";
import {
  DebugPanelFrame,
  EmptyPanelState,
  cellStyle,
  durationMs,
  formatClock,
  formatDuration,
  monoStyle,
} from "./panelPrimitives";
import { createActionLogEntries, type ActionLogEntry, type ActionLogStatus } from "./actionLogModel";

export interface ActionLogPanelProps {
  agents?: UiAgentRuntime[];
  requests?: ActionRequest[];
  results?: ActionResult[];
  events?: GameEvent[];
}

export function ActionLogPanel(props: ActionLogPanelProps): JSX.Element {
  const storeAgents = useStudioStore((state) => state.agents);
  const storeEvents = useStudioStore((state) => state.events);
  const agents = props.agents ?? storeAgents;
  const entries = createActionLogEntries({
    requests: props.requests,
    results: props.results,
    events: props.events ?? storeEvents,
  }).slice(0, 30);
  const failed = entries.find((entry) => isFailure(entry.status));

  return (
    <DebugPanelFrame
      icon={<ListChecks size={14} aria-hidden="true" />}
      meta="F27"
      rightSection={<FailureBadge count={entries.filter((entry) => isFailure(entry.status)).length} />}
      subtitle="Requests, results, latency, failure reasons"
      title="Action log"
    >
      {entries.length === 0 ? (
        <EmptyPanelState
          detail="Action requests and scheduler results will appear here as agents execute Minecraft commands."
          icon={<ListChecks size={16} aria-hidden="true" />}
          title="No action traffic yet"
        />
      ) : (
        <Stack gap="xs">
          <Box style={{ overflowX: "auto" }}>
            <Table highlightOnHover horizontalSpacing="xs" style={{ minWidth: 700 }} verticalSpacing={5}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Agent</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Duration</Table.Th>
                  <Table.Th>Failure reason</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entries.map((entry) => (
                  <Table.Tr key={entry.requestId} style={isFailure(entry.status) ? { background: "rgba(255, 111, 97, 0.08)" } : undefined}>
                    <Table.Td style={monoStyle}>{formatClock(entry.completedAt ?? entry.startedAt ?? entry.requestedAt)}</Table.Td>
                    <Table.Td>{agentName(entry.agentId, agents)}</Table.Td>
                    <Table.Td>
                      <Code color="dark" style={monoStyle}>
                        {entry.action}
                      </Code>
                    </Table.Td>
                    <Table.Td>
                      <StatusBadge status={entry.status} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <TimerReset size={12} aria-hidden="true" />
                        <Text size="xs" style={monoStyle}>
                          {formatDuration(durationMs(entry.startedAt, entry.completedAt))}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text c={isFailure(entry.status) ? "var(--mcas-red)" : "dimmed"} size="xs" truncate title={entry.failureReason ?? "none"}>
                        {entry.failureReason ?? "none"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
          {failed ? <FailureInspector entry={failed} /> : null}
        </Stack>
      )}
    </DebugPanelFrame>
  );
}

function FailureBadge({ count }: { count: number }): JSX.Element {
  return (
    <Badge color={count > 0 ? "red" : "lime"} radius="xs" size="xs" variant="light">
      {count} failed
    </Badge>
  );
}

function StatusBadge({ status }: { status: ActionLogStatus }): JSX.Element {
  const color = isFailure(status) ? "red" : status === "running" ? "yellow" : status === "succeeded" ? "lime" : "gray";
  return (
    <Badge color={color} radius="xs" size="xs" variant="light">
      {status}
    </Badge>
  );
}

function FailureInspector({ entry }: { entry: ActionLogEntry }): JSX.Element {
  return (
    <Box style={{ ...cellStyle, borderColor: "rgba(255, 111, 97, 0.45)" }}>
      <Group gap="xs" mb={6}>
        <TriangleAlert color="var(--mcas-red)" size={14} aria-hidden="true" />
        <Text fw={760} size="xs">
          Latest failed action
        </Text>
        <Badge color="red" radius="xs" size="xs" variant="outline">
          {entry.requestId}
        </Badge>
      </Group>
      <Text c="var(--mcas-red)" size="xs">
        {entry.failureReason ?? "No failure reason supplied"}
      </Text>
      <Code block mt={8} style={{ ...monoStyle, whiteSpace: "pre-wrap" }}>
        {JSON.stringify({ request: entry.request, result: entry.result }, null, 2)}
      </Code>
    </Box>
  );
}

function isFailure(status: ActionLogStatus): boolean {
  return status === "failed" || status === "rejected" || status === "canceled";
}

function agentName(agentId: string, agents: UiAgentRuntime[]): string {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}
