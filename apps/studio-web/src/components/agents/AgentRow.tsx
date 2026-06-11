import type { CSSProperties } from "react";
import { Bot } from "lucide-react";

import type { UiAgentRuntime } from "../../lib/types";
import { AgentModeChip } from "./AgentModeChip";
import { formatLastUpdate, healthReadout, taskForAgent } from "./agentFormat";

interface AgentRowProps {
  agent: UiAgentRuntime;
  selected: boolean;
  onSelect: (agentId: string) => void;
}

export function AgentRow({ agent, selected, onSelect }: AgentRowProps): JSX.Element {
  const health = healthReadout(agent);
  const task = taskForAgent(agent);

  return (
    <button
      type="button"
      className="agent-row"
      data-selected={selected}
      data-testid={`agent-row-${agent.id}`}
      onClick={() => onSelect(agent.id)}
      aria-label={`Inspect ${agent.name}`}
    >
      <span className="agent-name-cell">
        <Bot size={14} aria-hidden="true" />
        <span>
          <strong>{agent.name}</strong>
          <small>{agent.account.username}</small>
        </span>
      </span>
      <span className="agent-role-cell" title={agent.role}>
        {agent.role}
      </span>
      <span className="agent-mode-cell">
        <AgentModeChip mode={agent.mode} compact />
      </span>
      <span className="agent-health-cell" data-tone={health.tone}>
        <span
          className="agent-health-bar"
          style={{ "--agent-health": `${health.percent}%` } as CSSProperties}
        />
        <span>{health.label}</span>
      </span>
      <span className="agent-task-cell" title={task}>
        {task}
      </span>
      <span className="agent-provider-cell" title={agent.providerRef}>
        {agent.providerRef}
      </span>
      <span className="agent-update-cell" title={agent.updatedAt ?? "No runtime update"}>
        {formatLastUpdate(agent.updatedAt)}
      </span>
    </button>
  );
}
