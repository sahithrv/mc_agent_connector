import { Badge, Box, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { Clapperboard, Flag, RadioTower, Users } from "lucide-react";

import {
  DebugPanelFrame,
  EmptyPanelState,
  cellStyle,
  monoStyle,
} from "../debug/panelPrimitives";
import type { ScenarioConfigView } from "./types";

export interface ScenarioPanelProps {
  scenario?: ScenarioConfigView | null;
  loading?: boolean;
  error?: string;
}

export function ScenarioPanel({ scenario, loading, error }: ScenarioPanelProps): JSX.Element {
  const goals = scenario?.startingGoals ?? [];
  const teams = scenario?.teams ?? [];
  const triggers = scenario?.directorTriggers ?? [];
  const secretRoles = scenario?.secretRoles ?? [];

  return (
    <DebugPanelFrame
      icon={<Clapperboard size={14} aria-hidden="true" />}
      meta="F23"
      subtitle={scenario ? scenario.id : "No scenario loaded"}
      title={scenario?.name ?? "Scenario"}
    >
      {error ? (
        <EmptyPanelState
          detail={error}
          icon={<Clapperboard size={16} aria-hidden="true" />}
          title="Scenario failed to load"
        />
      ) : null}
      {!error && !scenario ? (
        <EmptyPanelState
          detail={loading ? "Waiting for scenario config" : "Load a scenario to inspect teams, goals, roles, and director triggers."}
          icon={<Clapperboard size={16} aria-hidden="true" />}
          title={loading ? "Loading scenario" : "No scenario loaded"}
        />
      ) : null}
      {scenario ? (
        <Stack gap="xs">
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
            <ScenarioStat label="Teams" value={teams.length} />
            <ScenarioStat label="Goals" value={goals.length} />
            <ScenarioStat label="Triggers" value={triggers.length} />
          </SimpleGrid>
          <Box style={cellStyle}>
            <Group gap="xs" mb={6}>
              <Users size={14} aria-hidden="true" />
              <Text fw={750} size="xs">
                Teams
              </Text>
              {secretRoles.length > 0 ? (
                <Badge color="violet" radius="xs" size="xs" variant="light">
                  {secretRoles.length} secret roles
                </Badge>
              ) : null}
            </Group>
            {teams.length === 0 ? (
              <Text c="dimmed" size="xs">
                Scenario has no teams.
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing={6}>
                {teams.map((team) => (
                  <Box key={team.id} style={{ borderLeft: "2px solid var(--mcas-green)", paddingLeft: 8 }}>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={700} size="xs" truncate>
                        {team.name ?? team.id}
                      </Text>
                      <Badge color="gray" radius="xs" size="xs" variant="outline">
                        {team.agentIds.length}
                      </Badge>
                    </Group>
                    <Text c="dimmed" size="xs" style={monoStyle} truncate title={team.agentIds.join(", ")}>
                      {team.agentIds.length > 0 ? team.agentIds.join(", ") : "no agents assigned"}
                    </Text>
                  </Box>
                ))}
              </SimpleGrid>
            )}
          </Box>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
            <ScenarioList
              empty="No starting goals configured."
              icon={<Flag size={14} aria-hidden="true" />}
              items={goals.map((goal) => ({
                id: `${goal.agentId}:${goal.priority}`,
                title: goal.agentId,
                meta: `P${goal.priority}`,
                detail: goal.goal,
              }))}
              title="Starting goals"
            />
            <ScenarioList
              empty="No director triggers configured."
              icon={<RadioTower size={14} aria-hidden="true" />}
              items={triggers.map((trigger) => ({
                id: trigger.id,
                title: trigger.event,
                meta: trigger.severity ? `S${trigger.severity}` : "auto",
                detail: trigger.action,
              }))}
              title="Director triggers"
            />
          </SimpleGrid>
        </Stack>
      ) : null}
    </DebugPanelFrame>
  );
}

function ScenarioStat(props: { label: string; value: number }): JSX.Element {
  return (
    <Box style={cellStyle}>
      <Text c="dimmed" size="xs" tt="uppercase">
        {props.label}
      </Text>
      <Text fw={780} mt={3} size="xl" style={monoStyle}>
        {props.value}
      </Text>
    </Box>
  );
}

function ScenarioList(props: {
  title: string;
  icon: JSX.Element;
  empty: string;
  items: Array<{ id: string; title: string; meta: string; detail: string }>;
}): JSX.Element {
  return (
    <Box style={cellStyle}>
      <Group gap="xs" mb={6}>
        {props.icon}
        <Text fw={750} size="xs">
          {props.title}
        </Text>
      </Group>
      {props.items.length === 0 ? (
        <Text c="dimmed" size="xs">
          {props.empty}
        </Text>
      ) : (
        <Stack gap={6}>
          {props.items.map((item) => (
            <Box key={item.id}>
              <Group gap={6} justify="space-between" wrap="nowrap">
                <Text fw={700} size="xs" truncate>
                  {item.title}
                </Text>
                <Badge color="lime" radius="xs" size="xs" variant="outline">
                  {item.meta}
                </Badge>
              </Group>
              <Text c="dimmed" size="xs" truncate title={item.detail}>
                {item.detail}
              </Text>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
