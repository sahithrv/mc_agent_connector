import type { AiChatMessage } from "@mc-ai-video/contracts";

import type { AiChatMessagesRepository } from "../db";
import type { AiChatMessageRecord } from "../db/types";
import type { AiChatRepository } from "./types";

export class SqliteAiChatRepository implements AiChatRepository {
  public constructor(
    private readonly messages: AiChatMessagesRepository,
    private readonly sessionId: string,
  ) {}

  public async save(message: AiChatMessage): Promise<void> {
    this.messages.create({
      id: message.id,
      sessionId: this.sessionId,
      senderId: message.senderId,
      recipients: message.recipientIds,
      topic: message.topic,
      urgency: message.urgency,
      visibility: message.visibility,
      content: message.content,
      timestamp: message.timestamp,
    });
  }

  public async list(): Promise<AiChatMessage[]> {
    return this.messages.listBySession({ sessionId: this.sessionId }).map(toContract);
  }
}

function toContract(record: AiChatMessageRecord): AiChatMessage {
  return {
    id: record.id,
    senderId: record.senderId,
    recipientIds: record.recipients,
    topic: record.topic,
    urgency: record.urgency,
    visibility: record.visibility,
    content: record.content,
    timestamp: record.timestamp,
  };
}
