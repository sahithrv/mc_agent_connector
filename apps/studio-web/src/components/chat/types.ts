import type { AiChatMessage, Position } from "@mc-ai-video/contracts";

export type StudioChatMessage = AiChatMessage & {
  location?: Position | string;
};

export interface ParticipantOption {
  value: string;
  label: string;
}
