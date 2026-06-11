import { Alert, Button, Drawer, Group, Text } from "@mantine/core";
import { AlertTriangle, PauseCircle, PlayCircle, X } from "lucide-react";

import type { UiAgentDiagnostics } from "../../lib/agents/types";
import type { UiAgentRuntime } from "../../lib/types";
import { AgentConfigPanel } from "./AgentConfigPanel";
import { AgentModeChip } from "./AgentModeChip";
import { MemoryList } from "./MemoryList";
import { RelationshipMatrix } from "./RelationshipMatrix";
import type { AgentPendingAction } from "./controlTypes";

interface AgentDetailDrawerProps {
  agent?: UiAgentRuntime;
  agents: UiAgentRuntime[];
  diagnostics?: UiAgentDiagnostics;
  opened: boolean;
  pendingAction: AgentPendingAction | null;
  error?: string;
  onClose: () => void;
  onPauseResume: () => void;
}

export function AgentDetailDrawer(props: AgentDetailDrawerProps): JSX.Element {
  const agent = props.agent;
  const nextAction = agent?.mode === "paused" ? "resume-agent" : "pause-agent";
  const actionLoading = props.pendingAction === nextAction;
  const busy = props.pendingAction !== null;

  return (
    <Drawer
      className="agent-detail-drawer"
      opened={props.opened}
      onClose={props.onClose}
      position="right"
      size="lg"
      title={agent ? `Agent diagnostics: ${agent.name}` : "Agent diagnostics"}
    >
      {!agent ? (
        <Alert color="yellow" variant="outline">
          No agent selected.
        </Alert>
      ) : (
        <div className="agent-drawer-stack">
          <div className="agent-drawer-hero">
            <div>
              <Text className="agent-drawer-kicker">{agent.id}</Text>
              <h2>{agent.name}</h2>
              <Text size="sm" c="dimmed">
                {agent.role} / {agent.providerRef}
              </Text>
            </div>
            <AgentModeChip mode={agent.mode} />
          </div>

          <Group gap={8} align="stretch">
            <Button
              color={agent.mode === "paused" ? "lime" : "red"}
              disabled={busy}
              leftSection={
                agent.mode === "paused" ? (
                  <PlayCircle size={14} aria-hidden="true" />
                ) : (
                  <PauseCircle size={14} aria-hidden="true" />
                )
              }
              loading={actionLoading}
              onClick={props.onPauseResume}
              variant="outline"
            >
              {agent.mode === "paused" ? "Resume agent" : "Pause agent"}
            </Button>
            <Button
              disabled={busy}
              leftSection={<X size={14} aria-hidden="true" />}
              onClick={props.onClose}
              variant="subtle"
            >
              Close
            </Button>
          </Group>

          {props.error ? (
            <Alert
              color="red"
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              variant="outline"
            >
              {props.error}
            </Alert>
          ) : null}

          <AgentConfigPanel agent={agent} diagnostics={props.diagnostics} />
          <RelationshipMatrix
            selectedAgent={agent}
            agents={props.agents}
            relationships={props.diagnostics?.relationships}
          />
          <MemoryList memories={props.diagnostics?.memories} />
        </div>
      )}
    </Drawer>
  );
}
