import { Alert, Button, Checkbox, Select, TextInput } from "@mantine/core";
import { Bot, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { addDirectorAgent } from "../../lib/api/director";
import { normalizeApiError } from "../../lib/api/client";
import type { UiAgentRuntime } from "../../lib/types";
import { directorRoleSelectData } from "./roleOptions";
import "./director.css";

export interface AddAgentFormProps {
  agents: readonly UiAgentRuntime[];
  api?: Parameters<typeof addDirectorAgent>[1];
  onAdded?: (agent: UiAgentRuntime) => void;
}

export function AddAgentForm({ agents, api, onAdded }: AddAgentFormProps): JSX.Element {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("Scout");
  const [team, setTeam] = useState("ai");
  const [subteam, setSubteam] = useState("");
  const [leader, setLeader] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const subteamOptions = useMemo(
    () =>
      [...new Set(agents.map((agent) => agent.subteam ?? agent.team).filter(Boolean))]
        .map((value) => ({ value: String(value), label: String(value) })),
    [agents],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setStatus(undefined);

    setLoading(true);
    try {
      const agent = await addDirectorAgent(
        {
          id: id.trim(),
          name: name.trim(),
          username: username.trim(),
          role,
          team: team.trim() || "ai",
          subteam: subteam.trim() || undefined,
          leader,
          providerRef: "deepseek",
        },
        api,
      );
      setStatus(`Added ${agent.id}; live runtime will connect it if live-agents is running.`);
      onAdded?.({ ...agent, mode: agent.mode ?? "routine" });
      setId("");
      setName("");
      setUsername("");
      setLeader(false);
    } catch (caught) {
      setError(normalizeApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="director-form" onSubmit={(event) => void submit(event)}>
      <div className="director-form-grid">
        <TextInput label="Agent ID" required placeholder="spy-2" value={id} onChange={(event) => setId(event.currentTarget.value)} />
        <TextInput label="Minecraft username" required placeholder="SpyTwo" value={username} onChange={(event) => setUsername(event.currentTarget.value)} />
      </div>
      <div className="director-form-grid">
        <TextInput label="Display name" required placeholder="Spy Two" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        <Select searchable label="Role" data={directorRoleSelectData} value={role} onChange={(value) => setRole(value ?? "Scout")} />
      </div>
      <div className="director-form-grid">
        <TextInput label="Team" value={team} onChange={(event) => setTeam(event.currentTarget.value)} />
        <Select searchable clearable label="Subteam" data={subteamOptions} value={subteam || null} onChange={(value) => setSubteam(value ?? "")} />
      </div>
      <Checkbox checked={leader} label="Subteam leader" onChange={(event) => setLeader(event.currentTarget.checked)} />
      {error ? (
        <Alert className="director-form-status" color="red" icon={<TriangleAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert className="director-form-status" color="green" icon={<Bot size={15} />}>
          {status}
        </Alert>
      ) : null}
      <Button disabled={!id.trim() || !name.trim() || !username.trim()} leftSection={<Bot size={14} />} loading={loading} type="submit">
        Add agent
      </Button>
    </form>
  );
}
