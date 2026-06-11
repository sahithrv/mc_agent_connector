import { Alert, Button, Group, MultiSelect, Select, Textarea, TextInput } from "@mantine/core";
import { SendHorizonal, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { AiChatMessage, EventSeverity } from "@mc-ai-video/contracts";

import type { SendDirectorChatInput } from "../../lib/api/chat";
import { validateChatDraft } from "../../lib/chat/validation";
import type { ParticipantOption } from "./types";

interface AiChatComposerProps {
  participants: ParticipantOption[];
  disabled?: boolean;
  onSend: (input: SendDirectorChatInput) => Promise<AiChatMessage>;
}

const urgencyOptions: Array<{ value: string; label: string }> = [
  { value: "1", label: "1 routine" },
  { value: "2", label: "2 low" },
  { value: "3", label: "3 watch" },
  { value: "4", label: "4 urgent" },
  { value: "5", label: "5 critical" },
];

export function AiChatComposer(props: AiChatComposerProps): JSX.Element {
  const [senderId, setSenderId] = useState("director");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [urgency, setUrgency] = useState<EventSeverity>(3);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const senderOptions = useMemo(() => props.participants, [props.participants]);
  const recipientOptions = useMemo(
    () => props.participants.filter((participant) => participant.value !== senderId),
    [props.participants, senderId],
  );
  const validRecipientIds = useMemo(
    () => new Set(recipientOptions.map((participant) => participant.value)),
    [recipientOptions],
  );

  async function submitMessage(): Promise<void> {
    const draft = {
      senderId,
      recipientIds,
      topic: topic.trim() || undefined,
      urgency,
      visibility: "ai" as const,
      content: content.trim(),
    };
    const validation = validateChatDraft(draft, validRecipientIds);
    setFieldErrors(validation.fieldErrors);
    setFormError(undefined);
    setStatus(undefined);

    if (!validation.valid) {
      return;
    }

    setSending(true);
    try {
      await props.onSend(draft);
      setContent("");
      setTopic("");
      setStatus("Private AI message queued.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to send private AI message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat-composer" aria-labelledby="ai-chat-composer-title">
      <div className="chat-composer__head">
        <div>
          <div className="chat-eyebrow">Director uplink</div>
          <h3 id="ai-chat-composer-title">AI private composer</h3>
        </div>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>

      {formError ? (
        <Alert color="red" variant="light">
          {formError}
        </Alert>
      ) : null}
      {status ? (
        <Alert color="lime" variant="light">
          {status}
        </Alert>
      ) : null}

      <div className="chat-composer__grid">
        <Select
          allowDeselect={false}
          data={senderOptions}
          disabled={props.disabled || sending}
          error={fieldErrors.senderId}
          label="Sender"
          onChange={(value) => {
            setSenderId(value ?? "director");
            setRecipientIds((current) => current.filter((id) => id !== value));
          }}
          value={senderId}
        />
        <Select
          allowDeselect={false}
          data={urgencyOptions}
          disabled={props.disabled || sending}
          label="Urgency"
          onChange={(value) => setUrgency(Number(value ?? 3) as EventSeverity)}
          value={String(urgency)}
        />
      </div>

      <TextInput
        disabled={props.disabled || sending}
        label="Topic"
        maxLength={128}
        onChange={(event) => setTopic(event.currentTarget.value)}
        placeholder="watchtower breach, trade route, base defense"
        value={topic}
      />

      <MultiSelect
        data={recipientOptions}
        disabled={props.disabled || sending || recipientOptions.length === 0}
        error={fieldErrors.recipientIds}
        label="Recipients"
        nothingFoundMessage="No eligible agents"
        onChange={setRecipientIds}
        placeholder="Select agents"
        searchable
        value={recipientIds}
      />

      <Textarea
        autosize
        disabled={props.disabled || sending}
        error={fieldErrors.content}
        label="Content"
        maxRows={5}
        minRows={4}
        onChange={(event) => setContent(event.currentTarget.value)}
        placeholder="Send a private AI coordination note..."
        value={content}
      />

      <Group justify="space-between" wrap="nowrap">
        <span className="chat-composer__hint">Routes through /director/chat as private AI traffic.</span>
        <Button
          disabled={props.disabled || sending}
          leftSection={<SendHorizonal size={14} />}
          loading={sending}
          onClick={() => void submitMessage()}
        >
          Send private
        </Button>
      </Group>
    </section>
  );
}
