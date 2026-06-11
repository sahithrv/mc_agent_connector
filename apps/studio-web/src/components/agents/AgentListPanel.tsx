import { Alert, Group, Text } from "@mantine/core";
import { RadioTower } from "lucide-react";

import type { UiAgentRuntime } from "../../lib/types";
import { AgentRow } from "./AgentRow";

interface AgentListPanelProps {
  agents: UiAgentRuntime[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
}

export function AgentListPanel(props: AgentListPanelProps): JSX.Element {
  return (
    <section className="agent-panel" aria-labelledby="agent-list-title">
      <div className="agent-panel-head">
        <Group gap={8}>
          <RadioTower size={16} aria-hidden="true" />
          <div>
            <h2 id="agent-list-title">Agent Rail</h2>
            <Text size="xs" c="dimmed">
              {props.agents.length} live player slots
            </Text>
          </div>
        </Group>
        <span className="agent-panel-kicker">F08-F09</span>
      </div>

      {props.agents.length === 0 ? (
        <Alert color="yellow" variant="outline" title="No agents loaded">
          Runtime snapshots or config load will populate the rail.
        </Alert>
      ) : (
        <div className="agent-table-shell">
          <div className="agent-list-head" aria-hidden="true">
            <span>Name</span>
            <span>Role</span>
            <span>Mode</span>
            <span>Health</span>
            <span>Task</span>
            <span>Provider</span>
            <span>Updated</span>
          </div>
          <div className="agent-row-list" role="list" aria-label="AI agents">
            {props.agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                selected={agent.id === props.selectedAgentId}
                onSelect={props.onSelectAgent}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
