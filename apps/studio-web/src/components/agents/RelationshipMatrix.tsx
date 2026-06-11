import type { CSSProperties } from "react";
import { Table } from "@mantine/core";
import { Network } from "lucide-react";

import type { UiAgentRelationship } from "../../lib/agents/types";
import type { UiAgentRuntime } from "../../lib/types";

interface RelationshipMatrixProps {
  selectedAgent: UiAgentRuntime;
  agents: UiAgentRuntime[];
  relationships?: UiAgentRelationship[];
}

interface RelationshipRow {
  targetId: string;
  targetName: string;
  relationship?: UiAgentRelationship;
}

export function RelationshipMatrix(props: RelationshipMatrixProps): JSX.Element {
  const rows = buildRows(props.selectedAgent, props.agents, props.relationships ?? []);
  const hasTelemetry = (props.relationships?.length ?? 0) > 0;

  return (
    <section className="agent-drawer-section" aria-labelledby="agent-relationships">
      <h3 id="agent-relationships">
        <Network size={14} aria-hidden="true" />
        Relationship Matrix
      </h3>
      {!hasTelemetry ? (
        <p className="agent-drawer-muted">No relationship telemetry yet; showing roster targets.</p>
      ) : null}
      <div className="relationship-matrix-shell">
        <Table className="relationship-matrix" withRowBorders={false} aria-label="Relationship matrix">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Target</Table.Th>
              <Table.Th>Trust</Table.Th>
              <Table.Th>Loyalty</Table.Th>
              <Table.Th>Fear</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.targetId}>
                <Table.Td>
                  <strong>{row.targetName}</strong>
                  <span>{row.targetId}</span>
                </Table.Td>
                <Table.Td>
                  <MetricCell tone="trust" value={row.relationship?.trust} />
                </Table.Td>
                <Table.Td>
                  <MetricCell tone="loyalty" value={row.relationship?.loyalty} />
                </Table.Td>
                <Table.Td>
                  <MetricCell tone="fear" value={row.relationship?.fear} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </section>
  );
}

function buildRows(
  selectedAgent: UiAgentRuntime,
  agents: UiAgentRuntime[],
  relationships: UiAgentRelationship[],
): RelationshipRow[] {
  const byTarget = new Map(relationships.map((item) => [item.targetAgentId, item]));
  const rows = new Map<string, RelationshipRow>();

  for (const agent of agents) {
    if (agent.id === selectedAgent.id) continue;
    rows.set(agent.id, {
      targetId: agent.id,
      targetName: agent.name,
      relationship: byTarget.get(agent.id),
    });
  }

  // Relationship records can point at humans or entities that are not in the AI agent roster.
  for (const relationship of relationships) {
    if (relationship.targetAgentId === selectedAgent.id || rows.has(relationship.targetAgentId)) {
      continue;
    }
    rows.set(relationship.targetAgentId, {
      targetId: relationship.targetAgentId,
      targetName: relationship.targetAgentId,
      relationship,
    });
  }

  return Array.from(rows.values()).sort((left, right) =>
    left.targetName.localeCompare(right.targetName),
  );
}

function MetricCell(props: {
  tone: "trust" | "loyalty" | "fear";
  value?: number;
}): JSX.Element {
  const missing = props.value === undefined || !Number.isFinite(props.value);
  const magnitude = missing ? 0 : Math.max(0, Math.min(100, Math.abs(props.value ?? 0)));

  return (
    <span className="relationship-metric" data-missing={missing} data-tone={props.tone}>
      <span
        className="relationship-bar"
        style={{ "--relationship-value": `${magnitude}%` } as CSSProperties}
      />
      <span>{missing ? "n/a" : Math.round(props.value ?? 0)}</span>
    </span>
  );
}
