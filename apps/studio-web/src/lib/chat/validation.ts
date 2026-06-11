import type { EventSeverity, Visibility } from "@mc-ai-video/contracts";

export interface ChatDraft {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility?: Visibility;
  content: string;
}

export type ChatDraftField = "senderId" | "recipientIds" | "content";

export interface ChatValidationResult {
  valid: boolean;
  fieldErrors: Partial<Record<ChatDraftField, string>>;
}

export function validateChatDraft(
  draft: ChatDraft,
  validRecipientIds: ReadonlySet<string>,
): ChatValidationResult {
  const fieldErrors: ChatValidationResult["fieldErrors"] = {};
  const recipients = draft.recipientIds.map((id) => id.trim()).filter(Boolean);

  if (!draft.senderId.trim()) {
    fieldErrors.senderId = "Select a sender.";
  }

  if (recipients.length === 0) {
    fieldErrors.recipientIds = "Select at least one recipient.";
  } else if (recipients.some((id) => !validRecipientIds.has(id))) {
    fieldErrors.recipientIds = "Remove recipients that are not in the agent directory.";
  }

  if (!draft.content.trim()) {
    fieldErrors.content = "Message content is required.";
  }

  return {
    valid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}
