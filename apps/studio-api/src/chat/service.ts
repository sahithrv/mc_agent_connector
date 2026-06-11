import { randomUUID } from "node:crypto";

import type { AiChatMessage } from "@mc-ai-video/contracts";

import type { StudioEventBus } from "../events/bus";
import {
  objectBody,
  optionalSeverity,
  optionalString,
  optionalVisibility,
  requiredString,
  requiredStringArray,
} from "../http/validation";
import type { AiChatRepository, ViewerRole } from "./types";
import { canViewChatMessage } from "./types";

export class AiChatService {
  constructor(
    private readonly repository: AiChatRepository,
    private readonly events: StudioEventBus,
  ) {}

  async sendFromBody(body: unknown): Promise<AiChatMessage> {
    const source = objectBody(body);
    const message: AiChatMessage = {
      id: optionalString(source, "id", 128) ?? randomUUID(),
      senderId: requiredString(source, "senderId", 128),
      recipientIds: requiredStringArray(source, "recipientIds"),
      topic: optionalString(source, "topic", 128),
      urgency: optionalSeverity(source, "urgency", 1),
      visibility: optionalVisibility(source, "visibility", "ai"),
      content: requiredString(source, "content", 2048),
      timestamp: optionalString(source, "timestamp", 64) ?? new Date().toISOString(),
    };

    await this.repository.save(message);
    this.events.emit("chat.message", message);
    return message;
  }

  async listForViewer(viewerRole: ViewerRole): Promise<AiChatMessage[]> {
    const messages = await this.repository.list();
    return messages.filter((message) => canViewChatMessage(viewerRole, message.visibility));
  }
}
