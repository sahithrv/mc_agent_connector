import { Alert, Badge, Loader, ScrollArea } from "@mantine/core";
import { Clock3, Hash, LockKeyhole, MapPin, Radio, TriangleAlert, Users } from "lucide-react";

import {
  formatLocation,
  formatTimestamp,
  participantLabel,
} from "./formatting";
import type { ParticipantOption, StudioChatMessage } from "./types";

interface ChatMessageLaneProps {
  title: string;
  detail: string;
  tone: "private" | "public";
  messages: StudioChatMessage[];
  participants: ParticipantOption[];
  loading?: boolean;
  error?: string;
  emptyTitle: string;
  emptyDetail: string;
}

export function ChatMessageLane(props: ChatMessageLaneProps): JSX.Element {
  const Icon = props.tone === "private" ? LockKeyhole : Radio;

  return (
    <section className="chat-lane" data-tone={props.tone} aria-labelledby={`${props.tone}-chat-title`}>
      <div className="chat-lane__head">
        <div>
          <h3 id={`${props.tone}-chat-title`}>{props.title}</h3>
          <p>{props.detail}</p>
        </div>
        <Badge color={props.tone === "private" ? "violet" : "cyan"} leftSection={<Icon size={12} />}>
          {props.messages.length}
        </Badge>
      </div>

      {props.error ? (
        <Alert color="red" variant="light" className="chat-status">
          {props.error}
        </Alert>
      ) : null}

      <ScrollArea className="chat-lane__scroll" offsetScrollbars>
        {props.loading ? (
          <div className="chat-empty" role="status">
            <Loader size="sm" />
            Loading chat traffic
          </div>
        ) : props.messages.length === 0 ? (
          <div className="chat-empty" role="status">
            <strong>{props.emptyTitle}</strong>
            <span>{props.emptyDetail}</span>
          </div>
        ) : (
          <div className="chat-message-stack">
            {props.messages.map((message) => (
              <ChatMessageItem
                key={message.id}
                message={message}
                participants={props.participants}
                tone={props.tone}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}

function ChatMessageItem(props: {
  message: StudioChatMessage;
  participants: ParticipantOption[];
  tone: "private" | "public";
}): JSX.Element {
  const urgency = props.message.urgency ?? 1;
  const urgent = urgency >= 4;
  const recipients = props.message.recipientIds.length > 0 ? props.message.recipientIds : ["broadcast"];

  return (
    <article className="chat-message" data-urgent={urgent} data-tone={props.tone}>
      <div className="chat-message__topline">
        <div className="chat-message__route">
          <strong>{participantLabel(props.message.senderId, props.participants)}</strong>
          <span>to</span>
          <span>{recipients.map((id) => participantLabel(id, props.participants)).join(", ")}</span>
        </div>
        <time dateTime={props.message.timestamp}>
          <Clock3 size={12} aria-hidden="true" />
          {formatTimestamp(props.message.timestamp)}
        </time>
      </div>

      <p className="chat-message__content">{props.message.content}</p>

      <div className="chat-message__meta" aria-label="Message metadata">
        <span>
          <Hash size={12} aria-hidden="true" />
          {props.message.topic ?? "untagged"}
        </span>
        <span>
          <MapPin size={12} aria-hidden="true" />
          {formatLocation(props.message.location)}
        </span>
        <span>
          <Users size={12} aria-hidden="true" />
          {props.message.visibility}
        </span>
        <span className={urgent ? "chat-message__urgent" : undefined}>
          <TriangleAlert size={12} aria-hidden="true" />
          urgency {urgency}
        </span>
      </div>
    </article>
  );
}
