import type { AiChatMessage, EventSeverity, Visibility } from "@mc-ai-video/contracts";

import { ApiClient } from "./client";
import type { ChatViewerRole } from "../chat/visibility";

export interface ChatMessagesResponse {
  messages: AiChatMessage[];
}

export interface DirectorChatResponse {
  ok: true;
  message: AiChatMessage;
}

export interface SendDirectorChatInput {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility?: Visibility;
  content: string;
}

const client = new ApiClient();

export async function getChatMessages(
  viewerRole: ChatViewerRole,
  api: ApiClient = client,
): Promise<AiChatMessage[]> {
  const query = new URLSearchParams({ viewerRole });
  const response = await api.get<ChatMessagesResponse>(`/chat/messages?${query.toString()}`);
  return response.messages;
}

export async function sendDirectorChat(
  input: SendDirectorChatInput,
  api: ApiClient = client,
): Promise<AiChatMessage> {
  const response = await api.request<DirectorChatResponse>("/director/chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.message;
}
