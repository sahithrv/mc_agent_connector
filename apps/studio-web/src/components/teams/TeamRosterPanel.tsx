import { Badge, Group, Text } from "@mantine/core";
import { Radio, UsersRound } from "lucide-react";

import type { UiTeamRoster, UiRosterMember } from "../../lib/agents/types";
import type { UiAgentRuntime } from "../../lib/types";
import { AgentModeChip } from "../agents/AgentModeChip";

interface TeamRosterPanelProps {
  agents: UiAgentRuntime[];
  roster?: UiTeamRoster;
}

export function TeamRosterPanel({ agents, roster }: TeamRosterPanelProps): JSX.Element {
  const aiGroups = groupAgentsByTeam(agents, roster?.aiTeamName ?? "AI Team");

  return (
    <aside className="agent-panel team-roster-panel" aria-labelledby="team-roster-title">
      <div className="agent-panel-head">
        <Group gap={8}>
          <UsersRound size={16} aria-hidden="true" />
          <div>
            <h2 id="team-roster-title">Team Roster</h2>
            <Text size="xs" c="dimmed">
              Assignment state for AI and humans
            </Text>
          </div>
        </Group>
        <span className="agent-panel-kicker">F30</span>
      </div>

      <div className="team-roster-stack">
        {aiGroups.map((group) => (
          <section className="team-roster-group" key={group.id}>
            <RosterHead label={group.name} count={group.agents.length} tone="ai" />
            <div className="team-member-list">
              {group.agents.map((agent) => (
                <div className="team-member-row" key={agent.id}>
                  <span>
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                  <AgentModeChip mode={agent.mode} compact />
                </div>
              ))}
            </div>
          </section>
        ))}

        {(roster?.humanTeams ?? []).map((team) => (
          <section className="team-roster-group" key={team.id}>
            <RosterHead label={team.name} count={team.members.length} tone="human" />
            <MemberList emptyLabel="No humans assigned" members={team.members} />
          </section>
        ))}

        <section className="team-roster-group">
          <RosterHead label="Recorders" count={roster?.recorders?.length ?? 0} tone="recorder" />
          <MemberList emptyLabel="No recorders connected" members={roster?.recorders ?? []} />
        </section>

        <section className="team-roster-group">
          <RosterHead
            label="Unaffiliated"
            count={roster?.unaffiliated?.length ?? 0}
            tone="unassigned"
          />
          <MemberList
            emptyLabel="No unaffiliated users visible"
            members={roster?.unaffiliated ?? []}
          />
        </section>
      </div>
    </aside>
  );
}

function groupAgentsByTeam(agents: UiAgentRuntime[], fallbackName: string) {
  const groups = new Map<string, { id: string; name: string; agents: UiAgentRuntime[] }>();

  // Agent configs only expose a team id, so the roster labels preserve that id until scenario names land.
  for (const agent of agents) {
    const teamId = agent.team ?? "ai-unassigned";
    const existing = groups.get(teamId);
    if (existing) {
      existing.agents.push(agent);
    } else {
      groups.set(teamId, {
        id: teamId,
        name: agent.team ? `AI: ${agent.team}` : fallbackName,
        agents: [agent],
      });
    }
  }

  return Array.from(groups.values());
}

function RosterHead(props: {
  label: string;
  count: number;
  tone: "ai" | "human" | "recorder" | "unassigned";
}): JSX.Element {
  return (
    <div className="team-roster-head">
      <span>
        <Radio size={13} aria-hidden="true" />
        {props.label}
      </span>
      <Badge className="team-count-badge" data-tone={props.tone} variant="outline">
        {props.count}
      </Badge>
    </div>
  );
}

function MemberList(props: { members: UiRosterMember[]; emptyLabel: string }): JSX.Element {
  if (props.members.length === 0) {
    return <p className="team-empty">{props.emptyLabel}</p>;
  }

  return (
    <div className="team-member-list">
      {props.members.map((member) => (
        <div className="team-member-row" key={member.id}>
          <span>
            <strong>{member.name}</strong>
            <small>{member.role ?? member.kind}</small>
          </span>
          <Badge className="team-status-badge" data-status={member.status ?? "unknown"}>
            {member.status ?? "unknown"}
          </Badge>
        </div>
      ))}
    </div>
  );
}
