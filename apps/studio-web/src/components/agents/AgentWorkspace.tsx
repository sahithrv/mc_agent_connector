import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Modal, Text } from "@mantine/core";
import { AlertTriangle, PauseOctagon, PlayCircle } from "lucide-react";

import { agentControls, type AgentControlApi } from "../../lib/api/agentControls";
import { normalizeApiError } from "../../lib/api/client";
import type { UiAgentDiagnostics, UiTeamRoster } from "../../lib/agents/types";
import { useStudioStore } from "../../lib/state/store";
import type { UiAgentRuntime } from "../../lib/types";
import { TeamRosterPanel } from "../teams/TeamRosterPanel";
import { AgentBulkControls } from "./AgentBulkControls";
import { AgentDetailDrawer } from "./AgentDetailDrawer";
import { AgentListPanel } from "./AgentListPanel";
import type { AgentPendingAction } from "./controlTypes";
import "./agent-workspace.css";

export interface AgentWorkspaceProps {
  controls?: AgentControlApi;
  diagnosticsByAgentId?: Record<string, UiAgentDiagnostics>;
  teamRoster?: UiTeamRoster;
}

export function AgentWorkspace(props: AgentWorkspaceProps): JSX.Element {
  const agents = useStudioStore((state) => state.agents);
  const controls = props.controls ?? agentControls;
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [drawerOpened, setDrawerOpened] = useState(false);
  const [pendingAction, setPendingAction] = useState<AgentPendingAction | null>(null);
  const [controlError, setControlError] = useState<string | undefined>();
  const [bulkConfirm, setBulkConfirm] = useState<"pause-all" | "resume-all" | null>(null);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId],
  );

  useEffect(() => {
    if (selectedAgentId && !selectedAgent) {
      setSelectedAgentId(undefined);
      setDrawerOpened(false);
    }
  }, [selectedAgent, selectedAgentId]);

  function selectAgent(agentId: string): void {
    setSelectedAgentId(agentId);
    setDrawerOpened(true);
    setControlError(undefined);
  }

  async function executeControl(
    action: AgentPendingAction,
    request: () => Promise<unknown>,
  ): Promise<boolean> {
    setPendingAction(action);
    setControlError(undefined);
    try {
      await request();
      return true;
    } catch (error) {
      setControlError(normalizeApiError(error).message);
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function pauseOrResumeSelected(): Promise<void> {
    if (!selectedAgent || pendingAction) return;

    const request = { reason: `Director control for ${selectedAgent.name}` };
    if (selectedAgent.mode === "paused") {
      await executeControl("resume-agent", () => controls.resumeAgent(selectedAgent.id, request));
    } else {
      await executeControl("pause-agent", () => controls.pauseAgent(selectedAgent.id, request));
    }
  }

  async function confirmBulkAction(): Promise<void> {
    if (!bulkConfirm || pendingAction) return;

    const ok =
      bulkConfirm === "pause-all"
        ? await executeControl("pause-all", () =>
            controls.pauseAll({ reason: "Confirmed director pause all" }),
          )
        : await executeControl("resume-all", () =>
            controls.resumeAll({ reason: "Confirmed director resume all" }),
          );

    if (ok) setBulkConfirm(null);
  }

  return (
    <section className="agent-workspace" aria-label="Agent workspace">
      <div className="agent-workspace-grid">
        <div className="agent-workspace-main">
          <AgentBulkControls
            agentCount={agents.length}
            error={controlError}
            onRequestPauseAll={() => setBulkConfirm("pause-all")}
            onRequestResumeAll={() => setBulkConfirm("resume-all")}
            pendingAction={pendingAction}
          />
          <AgentListPanel
            agents={agents}
            onSelectAgent={selectAgent}
            selectedAgentId={selectedAgentId}
          />
        </div>
        <TeamRosterPanel agents={agents} roster={props.teamRoster} />
      </div>

      <AgentDetailDrawer
        agent={selectedAgent}
        agents={agents}
        diagnostics={selectedAgentId ? props.diagnosticsByAgentId?.[selectedAgentId] : undefined}
        error={controlError}
        onClose={() => setDrawerOpened(false)}
        onPauseResume={() => void pauseOrResumeSelected()}
        opened={drawerOpened}
        pendingAction={pendingAction}
      />

      <Modal
        centered
        closeOnClickOutside={!pendingAction}
        closeOnEscape={!pendingAction}
        onClose={() => {
          if (!pendingAction) setBulkConfirm(null);
        }}
        opened={bulkConfirm !== null}
        title={bulkConfirm === "pause-all" ? "Confirm pause all agents" : "Confirm resume all agents"}
      >
        <div className="agent-confirm-stack">
          <Text size="sm">
            {bulkConfirm === "pause-all"
              ? "This will request a pause command for every loaded AI player."
              : "This will request a resume command for every loaded AI player."}
          </Text>
          {controlError ? (
            <Alert
              color="red"
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              variant="outline"
            >
              {controlError}
            </Alert>
          ) : null}
          <Group justify="flex-end" gap={8}>
            <Button disabled={pendingAction !== null} onClick={() => setBulkConfirm(null)} variant="subtle">
              Cancel
            </Button>
            <Button
              color={bulkConfirm === "pause-all" ? "red" : "lime"}
              disabled={pendingAction !== null && pendingAction !== bulkConfirm}
              leftSection={
                bulkConfirm === "pause-all" ? (
                  <PauseOctagon size={14} aria-hidden="true" />
                ) : (
                  <PlayCircle size={14} aria-hidden="true" />
                )
              }
              loading={pendingAction === bulkConfirm}
              onClick={() => void confirmBulkAction()}
              variant="outline"
            >
              {bulkConfirm === "pause-all" ? "Confirm pause all" : "Confirm resume all"}
            </Button>
          </Group>
        </div>
      </Modal>
    </section>
  );
}

export type { UiAgentRuntime };
