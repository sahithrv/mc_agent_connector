import { Alert, Button, Group, Text, Tooltip } from "@mantine/core";
import { AlertTriangle, PauseOctagon, PlayCircle } from "lucide-react";

import type { AgentPendingAction } from "./controlTypes";

interface AgentBulkControlsProps {
  agentCount: number;
  pendingAction: AgentPendingAction | null;
  error?: string;
  onRequestPauseAll: () => void;
  onRequestResumeAll: () => void;
}

export function AgentBulkControls(props: AgentBulkControlsProps): JSX.Element {
  const busy = props.pendingAction !== null;
  const disabled = props.agentCount === 0 || busy;

  return (
    <section className="agent-command-strip" aria-label="Agent bulk controls">
      <div>
        <Text className="agent-command-title">Director Interlock</Text>
        <Text size="xs" c="dimmed">
          Bulk commands require a confirmation gate.
        </Text>
      </div>
      <Group gap={8} justify="flex-end">
        <Tooltip label={props.agentCount === 0 ? "No agents loaded" : "Confirm before pausing all"}>
          <Button
            color="red"
            disabled={disabled}
            leftSection={<PauseOctagon size={14} aria-hidden="true" />}
            loading={props.pendingAction === "pause-all"}
            onClick={props.onRequestPauseAll}
            variant="outline"
          >
            Pause all
          </Button>
        </Tooltip>
        <Tooltip label={props.agentCount === 0 ? "No agents loaded" : "Confirm before resuming all"}>
          <Button
            color="lime"
            disabled={disabled}
            leftSection={<PlayCircle size={14} aria-hidden="true" />}
            loading={props.pendingAction === "resume-all"}
            onClick={props.onRequestResumeAll}
            variant="outline"
          >
            Resume all
          </Button>
        </Tooltip>
      </Group>
      {props.error ? (
        <Alert
          className="agent-command-error"
          color="red"
          icon={<AlertTriangle size={14} aria-hidden="true" />}
          variant="outline"
        >
          {props.error}
        </Alert>
      ) : null}
    </section>
  );
}
