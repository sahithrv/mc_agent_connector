import { Alert, Button, Select, Textarea, TextInput } from "@mantine/core";
import type { AiChatMessage, EventSeverity } from "@mc-ai-video/contracts";
import { Radio, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { normalizeApiError } from "../../lib/api/client";
import { sendDirectorAnnouncement } from "../../lib/api/director";
import { EVENT_SEVERITY_VALUES } from "../../lib/events/filters";
import "./director.css";

export interface GroupAnnouncementFormProps {
  api?: Parameters<typeof sendDirectorAnnouncement>[1];
  onSuccess?: (message: AiChatMessage) => void;
}

export function GroupAnnouncementForm({ api, onSuccess }: GroupAnnouncementFormProps): JSX.Element {
  const [senderId, setSenderId] = useState("director");
  const [recipients, setRecipients] = useState("");
  const [topic, setTopic] = useState("");
  const [urgency, setUrgency] = useState<EventSeverity>(3);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setSent(undefined);

    const recipientIds = parseRecipients(recipients);
    if (recipientIds.length === 0) {
      setError("At least one recipient is required.");
      return;
    }

    setLoading(true);
    try {
      const message = await sendDirectorAnnouncement(
        {
          senderId: senderId.trim(),
          recipientIds,
          topic: optionalText(topic),
          urgency,
          visibility: "ai",
          content: content.trim(),
        },
        api,
      );
      setSent(`Sent to ${message.recipientIds.length} recipient(s).`);
      setContent("");
      onSuccess?.(message);
    } catch (caught) {
      setError(normalizeApiError(caught).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="director-form" onSubmit={(event) => void submit(event)}>
      <div className="director-form-grid">
        <TextInput
          label="Sender"
          required
          value={senderId}
          onChange={(event) => setSenderId(event.currentTarget.value)}
        />
        <TextInput
          label="Recipients"
          placeholder="leader, scout-2"
          required
          value={recipients}
          onChange={(event) => setRecipients(event.currentTarget.value)}
        />
      </div>
      <div className="director-form-grid">
        <TextInput
          label="Topic"
          placeholder="raid timing"
          value={topic}
          onChange={(event) => setTopic(event.currentTarget.value)}
        />
        <Select
          label="Urgency"
          data={EVENT_SEVERITY_VALUES.map((value) => ({ value: String(value), label: `U${value}` }))}
          value={String(urgency)}
          onChange={(value) => setUrgency(Number(value ?? 3) as EventSeverity)}
        />
      </div>
      <Textarea
        autosize
        minRows={3}
        label="Content"
        required
        value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
      />
      {error ? (
        <Alert className="director-form-status" color="red" icon={<TriangleAlert size={15} />}>
          {error}
        </Alert>
      ) : null}
      {sent ? (
        <Alert className="director-form-status" color="green" icon={<Radio size={15} />}>
          {sent}
        </Alert>
      ) : null}
      <Button leftSection={<Radio size={14} />} loading={loading} type="submit">
        Send announcement
      </Button>
    </form>
  );
}

function parseRecipients(value: string): string[] {
  return value
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
