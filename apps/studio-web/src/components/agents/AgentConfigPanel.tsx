import { Badge, Group } from "@mantine/core";
import { BrainCircuit, ClipboardList, Settings2 } from "lucide-react";

import type { UiAgentDiagnostics } from "../../lib/agents/types";
import type { UiAgentRuntime } from "../../lib/types";
import { taskForAgent } from "./agentFormat";

interface AgentConfigPanelProps {
  agent: UiAgentRuntime;
  diagnostics?: UiAgentDiagnostics;
}

export function AgentConfigPanel(props: AgentConfigPanelProps): JSX.Element {
  const { agent, diagnostics } = props;
  const decision = diagnostics?.lastDecision;

  return (
    <>
      <section className="agent-drawer-section" aria-labelledby="agent-current-task">
        <h3 id="agent-current-task">
          <ClipboardList size={14} aria-hidden="true" />
          Current Task
        </h3>
        <p className="agent-drawer-copy">{agent.currentTask ?? "No current task published"}</p>
        <div className="agent-drawer-muted">Fallback routine: {taskForAgent(agent)}</div>
      </section>

      <section className="agent-drawer-section" aria-labelledby="agent-config">
        <h3 id="agent-config">
          <Settings2 size={14} aria-hidden="true" />
          Config
        </h3>
        <div className="agent-facts-grid">
          <Fact label="Role" value={agent.role} />
          <Fact label="Team" value={agent.team ?? "unassigned"} />
          <Fact label="Provider" value={agent.providerRef} />
          <Fact label="Account" value={agent.account.username} />
          <Fact label="Routine" value={agent.routine ?? "role default"} />
          <Fact label="Visibility" value={agent.visibility ?? "public"} />
        </div>
        <Group gap={6} mt={10}>
          {agent.allowedActions.length > 0 ? (
            agent.allowedActions.slice(0, 8).map((action) => (
              <Badge key={action} className="agent-action-badge" variant="outline">
                {action}
              </Badge>
            ))
          ) : (
            <span className="agent-drawer-muted">No allowed actions configured</span>
          )}
        </Group>
      </section>

      <section className="agent-drawer-section" aria-labelledby="agent-last-decision">
        <h3 id="agent-last-decision">
          <BrainCircuit size={14} aria-hidden="true" />
          Last Decision
        </h3>
        {decision ? (
          <div className="agent-facts-grid">
            <Fact label="Action" value={decision.action ?? "none"} />
            <Fact label="Reason" value={decision.reason ?? "not provided"} />
            <Fact
              label="Confidence"
              value={
                decision.confidence === undefined
                  ? "n/a"
                  : `${Math.round(decision.confidence * 100)}%`
              }
            />
            <Fact label="At" value={decision.createdAt ?? "not published"} />
            <div className="agent-fact-wide">
              <Fact label="Note" value={decision.note ?? "No note attached"} />
            </div>
          </div>
        ) : (
          <p className="agent-drawer-muted">No planner decision has been published.</p>
        )}
      </section>
    </>
  );
}

function Fact(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="agent-fact">
      <span>{props.label}</span>
      <strong title={props.value}>{props.value}</strong>
    </div>
  );
}
