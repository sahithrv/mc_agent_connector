import type { AiChatMessage } from "@mc-ai-video/contracts";

import type { AiChatRepository } from "./types";

export class InMemoryAiChatRepository implements AiChatRepository {
  private readonly messages: AiChatMessage[] = [];

  async save(message: AiChatMessage): Promise<void> {
    this.messages.push(message);
  }

  async list(): Promise<AiChatMessage[]> {
    return [...this.messages].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }
}
