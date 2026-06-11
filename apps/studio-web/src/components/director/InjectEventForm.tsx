import { Alert, Button, Select, Textarea, TextInput } from "@mantine/core";
import type { EventSeverity, GameEvent, JsonValue } from "@mc-ai-video/contracts";
import { Send, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { injectDirectorEvent } from "../../lib/api/director";
import { normalizeApiError } from "../../lib/api/client";
import { EVENT_SEVERITY_VALUES } from "../../lib/events/filters";
import "./director.css";

export interface InjectEventFormProps {
  api?: Parameters<typeof injectDirectorEvent>[1];
  onSuccess?: (event: GameEvent) => void;
}

export function InjectEventForm({ api, onSuccess }: InjectEventFormProps): JSX.Element {
  const [type, setType] = useState("");
  const [actorId, setActorId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [severity, setSeverity] = useState<EventSeverity>(3);
  const [payloadText, setPayloadText] = useState("{\n  \"note\": \"\"\n}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [payloadError, setPayloadError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setPayloadError(undefined);

    const payload = parsePayload(payloadText);
    if (!payload.ok) {
      setPayloadError(payload.error);
      return;
    }

    setLoading(true);
    try {
      const injected = await injectDirectorEvent(
        {
          type: type.trim(),
          actorId: optionalText(actorId),
          targetId: optionalText(targetId),
          severity,
          visibility: "public",
          payload: payload.value,
        },
        api,
      );
      onSuccess?.(injected);
      setPayloadText("{\n  \"note\": \"\"\n}");
    } catch (caught) {
      setError(normalizeApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="director-form" onSubmit={(event) => void submit(event)}>
      <TextInput
        label="Event type"
        placeholder="leader.attack"
        required
        value={type}
        onChange={(event) => setType(event.currentTarget.value)}
      />
      <div className="director-form-grid">
        <TextInput
          label="Actor"
          placeholder="agent-id"
          value={actorId}
          onChange={(event) => setActorId(event.currentTarget.value)}
        />
        <TextInput
          label="Target"
          placeholder="agent-id"
          value={targetId}
          onChange={(event) => setTargetId(event.currentTarget.value)}
        />
      </div>
      <Select
        label="Severity"
        data={EVENT_SEVERITY_VALUES.map((value) => ({ value: String(value), label: `S${value}` }))}
        value={String(severity)}
        onChange={(value) => setSeverity(Number(value ?? 3) as EventSeverity)}
      />
      <Textarea
        autosize
        minRows={4}
        label="Payload JSON"
        error={payloadError}
        value={payloadText}
        onChange={(event) => setPayloadText(event.currentTarget.value)}
      />
      {error ? (
        <Alert className="director-form-status" color="red" icon={<TriangleAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      <Button leftSection={<Send size={14} />} loading={loading} type="submit">
        Inject event
      </Button>
    </form>
  );
}

function parsePayload(
  text: string,
): { ok: true; value: Record<string, JsonValue> } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Payload must be a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, JsonValue> };
  } catch {
    return { ok: false, error: "Payload JSON is invalid." };
  }
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
