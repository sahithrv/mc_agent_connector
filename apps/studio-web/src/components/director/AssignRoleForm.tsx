import { Alert, Button, SegmentedControl, Select, TextInput } from "@mantine/core";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { RoleAssignmentInput } from "../../lib/api/director";
import { unsupportedRoleAssignment } from "../../lib/api/director";
import type { UiAgentRuntime } from "../../lib/types";
import "./director.css";

export interface AssignRoleFormProps {
  agents: readonly UiAgentRuntime[];
  onAssignRole?: (assignment: RoleAssignmentInput) => Promise<void> | void;
}

export function AssignRoleForm({ agents, onAssignRole }: AssignRoleFormProps): JSX.Element {
  const [agentId, setAgentId] = useState("");
  const [role, setRole] = useState("");
  const [secret, setSecret] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const agentOptions = agents.map((agent) => ({ value: agent.id, label: `${agent.name} / ${agent.id}` }));

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(undefined);
    setError(undefined);

    const assignment = {
      agentId,
      role: role.trim(),
      secret,
      requestedBy: "director",
    };

    if (!onAssignRole) {
      setError(unsupportedRoleAssignment(assignment).message);
      return;
    }

    setLoading(true);
    try {
      await onAssignRole(assignment);
      setStatus(`${secret ? "Secret role" : "Role"} assigned to ${agentId}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Role assignment failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="director-form" onSubmit={(event) => void submit(event)}>
      <Alert color={onAssignRole ? "green" : "yellow"} icon={<ShieldAlert size={15} />}>
        {onAssignRole
          ? "Role assignments will update the active studio roster."
          : "The V1 director API does not expose role assignment yet."}
      </Alert>
      <div className="director-form-grid">
        <Select
          searchable
          label="Agent"
          data={agentOptions}
          placeholder="Select agent"
          value={agentId || null}
          onChange={(value) => setAgentId(value ?? "")}
        />
        <TextInput
          label="Role"
          placeholder="traitor, courier"
          required
          value={role}
          onChange={(event) => setRole(event.currentTarget.value)}
        />
      </div>
      <SegmentedControl
        aria-label="Role visibility"
        data={[
          { label: "Role", value: "role" },
          { label: "Secret role", value: "secret" },
        ]}
        value={secret ? "secret" : "role"}
        onChange={(value) => setSecret(value === "secret")}
      />
      {error ? (
        <Alert color="red" icon={<ShieldAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      {status ? (
        <Alert color="green" icon={<LockKeyhole size={15} />}>
          {status}
        </Alert>
      ) : null}
      <Button
        disabled={!agentId || !role.trim()}
        leftSection={<LockKeyhole size={14} />}
        loading={loading}
        type="submit"
      >
        Assign role
      </Button>
    </form>
  );
}
