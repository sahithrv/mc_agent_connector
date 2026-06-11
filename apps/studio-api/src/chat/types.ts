import type { AiChatMessage, Visibility } from "@mc-ai-video/contracts";

export type ViewerRole = "recorder" | "ai-team-human" | "human-team" | "unaffiliated";

export interface ChatQuery {
  viewerRole: ViewerRole;
}

export interface AiChatRepository {
  save(message: AiChatMessage): Promise<void>;
  list(): Promise<AiChatMessage[]>;
}

export function canViewChatMessage(role: ViewerRole, visibility: Visibility): boolean {
  if (visibility === "public") {
    return true;
  }

  // Permission filtering is intentionally conservative: private AI chat stays inside
  // the app, recorders see all private traffic, and unaffiliated viewers see none.
  if (role === "recorder") {
    return true;
  }
  if (role === "ai-team-human") {
    return visibility === "ai";
  }
  if (role === "human-team") {
    return visibility === "human-team";
  }
  return false;
}
