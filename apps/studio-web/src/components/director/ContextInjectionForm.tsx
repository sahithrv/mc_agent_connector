import { Alert, Button, Checkbox, Select, Textarea, TextInput } from "@mantine/core";
import { Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import {
  injectDirectorCommand,
  type DirectorInjectionKind,
  type DirectorInjectionScope,
} from "../../lib/api/director";
import { normalizeApiError } from "../../lib/api/client";
import type { UiAgentRuntime } from "../../lib/types";
import { directorRoleSelectData } from "./roleOptions";
import "./director.css";

export interface ContextInjectionFormProps {
  agents: readonly UiAgentRuntime[];
  api?: Parameters<typeof injectDirectorCommand>[1];
}

const injectionKinds: Array<{ value: DirectorInjectionKind; label: string }> = [
  { value: "god-dialogue", label: "Dialogue from gods" },
  { value: "task", label: "Individual task" },
  { value: "team-task", label: "Team task" },
  { value: "role", label: "Role change" },
  { value: "personality", label: "Personality change" },
  { value: "trait", label: "Trait" },
  { value: "memory", label: "Memory" },
  { value: "instruction", label: "Instruction" },
];

const scopeOptions: Array<{ value: DirectorInjectionScope; label: string }> = [
  { value: "agent", label: "Agent" },
  { value: "subteam", label: "Subteam" },
  { value: "all", label: "All agents" },
];

export function ContextInjectionForm({ agents, api }: ContextInjectionFormProps): JSX.Element {
  const [kind, setKind] = useState<DirectorInjectionKind>("god-dialogue");
  const [scope, setScope] = useState<DirectorInjectionScope>("subteam");
  const [agentId, setAgentId] = useState("");
  const [subteamId, setSubteamId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [secret, setSecret] = useState(true);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();

  const agentOptions = agents.map((agent) => ({
    value: agent.id,
    label: `${agent.name} / ${agent.id}`,
  }));
  const subteamOptions = useMemo(
    () =>
      [...new Set(agents.map((agent) => agent.subteam ?? agent.team).filter(Boolean))]
        .map((team) => ({ value: String(team), label: String(team) })),
    [agents],
  );
  const effectiveText = kind === "role" && selectedRole ? selectedRole : text.trim();

  function updateKind(value: string | null): void {
    const next = (value ?? "god-dialogue") as DirectorInjectionKind;
    setKind(next);
    if (next === "team-task") setScope("subteam");
    if (next === "task" || next === "role") setScope("agent");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setStatus(undefined);

    if (scope === "agent" && !agentId) {
      setError("Choose an agent target.");
      return;
    }
    if (scope === "subteam" && !subteamId) {
      setError("Choose a subteam target.");
      return;
    }
    if (!effectiveText) {
      setError("Enter the text to inject.");
      return;
    }

    setLoading(true);
    try {
      const command = await injectDirectorCommand(
        {
          kind,
          scope,
          agentId: scope === "agent" ? agentId : undefined,
          subteamId: scope === "subteam" ? subteamId : undefined,
          taskId: taskId.trim() || undefined,
          secret,
          text: effectiveText,
          requestedBy: "director",
        },
        api,
      );
      setStatus(`Injected ${command.type}.`);
      if (kind !== "role") setText("");
    } catch (caught) {
      setError(normalizeApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="director-form" onSubmit={(event) => void submit(event)}>
      <div className="director-form-grid">
        <Select
          label="Injection"
          data={injectionKinds}
          value={kind}
          onChange={updateKind}
        />
        <Select
          label="Target"
          data={scopeOptions}
          value={scope}
          onChange={(value) => setScope((value ?? "all") as DirectorInjectionScope)}
        />
      </div>
      <div className="director-form-grid">
        {scope === "agent" ? (
          <Select
            searchable
            label="Agent"
            data={agentOptions}
            placeholder="Select agent"
            value={agentId || null}
            onChange={(value) => setAgentId(value ?? "")}
          />
        ) : null}
        {scope === "subteam" ? (
          <Select
            searchable
            label="Subteam"
            data={subteamOptions}
            placeholder="Select subteam"
            value={subteamId || null}
            onChange={(value) => setSubteamId(value ?? "")}
          />
        ) : null}
        {kind === "task" || kind === "team-task" ? (
          <TextInput
            label="Task ID"
            placeholder="village-base-1"
            value={taskId}
            onChange={(event) => setTaskId(event.currentTarget.value)}
          />
        ) : null}
        {kind === "role" ? (
          <Select
            searchable
            label="Role"
            data={directorRoleSelectData}
            placeholder="Choose role"
            value={selectedRole || null}
            onChange={(value) => setSelectedRole(value ?? "")}
          />
        ) : null}
      </div>
      {kind === "role" ? (
        <Checkbox
          checked={secret}
          label="Treat as secret role context"
          onChange={(event) => setSecret(event.currentTarget.checked)}
        />
      ) : null}
      <Textarea
        autosize
        minRows={4}
        label={kind === "role" ? "Extra note" : "Text"}
        placeholder="Type exactly what the AI should receive..."
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      {error ? (
        <Alert className="director-form-status" color="red" icon={<TriangleAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert className="director-form-status" color="green" icon={<Sparkles size={15} />}>
          {status}
        </Alert>
      ) : null}
      <Button disabled={!effectiveText} leftSection={<Sparkles size={14} />} loading={loading} type="submit">
        Inject
      </Button>
    </form>
  );
}
