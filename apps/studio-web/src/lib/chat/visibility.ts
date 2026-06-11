import type { Visibility } from "@mc-ai-video/contracts";

export type ChatViewerRole = "recorder" | "ai-team-human" | "human-team" | "unaffiliated";

export const CHAT_VIEWER_ROLE_OPTIONS: Array<{
  value: ChatViewerRole;
  label: string;
  description: string;
}> = [
  {
    value: "recorder",
    label: "Recorder",
    description: "All private channels plus public chat.",
  },
  {
    value: "ai-team-human",
    label: "AI-team human",
    description: "AI private channel plus public chat.",
  },
  {
    value: "human-team",
    label: "Human team",
    description: "Human-team private channel plus public chat.",
  },
  {
    value: "unaffiliated",
    label: "Unaffiliated",
    description: "Public chat only.",
  },
];

export function canViewerSeeChatVisibility(
  viewerRole: ChatViewerRole,
  visibility: Visibility,
): boolean {
  if (visibility === "public") {
    return true;
  }

  // Permission filtering mirrors the API and stays deny-by-default:
  // unaffiliated viewers never see private AI or team coordination traffic.
  if (viewerRole === "recorder") {
    return true;
  }
  if (viewerRole === "ai-team-human") {
    return visibility === "ai";
  }
  if (viewerRole === "human-team") {
    return visibility === "human-team";
  }
  return false;
}

export function filterChatMessagesForViewer<T extends { visibility: Visibility }>(
  messages: readonly T[],
  viewerRole: ChatViewerRole,
): T[] {
  return messages.filter((message) => canViewerSeeChatVisibility(viewerRole, message.visibility));
}

export function isPrivateChatVisibility(visibility: Visibility): boolean {
  return visibility !== "public";
}
