import type { AiChatMessage } from "@mc-ai-video/contracts";

export interface ChatContextOptions {
  viewerAgentId?: string;
  recorderIds?: string[];
  maxRecentMessages?: number;
  maxSummaryLength?: number;
}

export interface SummarizedChatContext {
  summary: string;
  recentMessages: AiChatMessage[];
  originalCount: number;
  consideredCount: number;
}

const DEFAULT_RECENT_COUNT = 6;
const DEFAULT_SUMMARY_LENGTH = 500;

export function excludeRecorderSocialMessages(
  messages: AiChatMessage[],
  recorderIds: string[] = [],
): AiChatMessage[] {
  const recorders = new Set(recorderIds);
  return messages.filter((message) => {
    if (recorders.has(message.senderId)) {
      return false;
    }
    if (message.recipientIds.length === 0) {
      return true;
    }
    return message.recipientIds.some((recipientId) => !recorders.has(recipientId));
  });
}

export function summarizeMultiAgentChat(
  messages: AiChatMessage[],
  options: ChatContextOptions = {},
): SummarizedChatContext {
  const maxRecentMessages = options.maxRecentMessages ?? DEFAULT_RECENT_COUNT;
  const maxSummaryLength = options.maxSummaryLength ?? DEFAULT_SUMMARY_LENGTH;
  const socialMessages = excludeRecorderSocialMessages(messages, options.recorderIds);
  const viewerAgentId = options.viewerAgentId;
  const relevant = viewerAgentId
    ? socialMessages.filter((message) =>
      message.senderId === viewerAgentId
        || message.recipientIds.length === 0
        || message.recipientIds.includes(viewerAgentId)
        || message.visibility === "public",
    )
    : socialMessages;

  const recentMessages = relevant.slice(-maxRecentMessages);
  const olderMessages = relevant.slice(0, Math.max(0, relevant.length - recentMessages.length));
  const summary = summarizeOlderMessages(olderMessages, maxSummaryLength);

  return {
    summary,
    recentMessages,
    originalCount: messages.length,
    consideredCount: relevant.length,
  };
}

function summarizeOlderMessages(messages: AiChatMessage[], maxLength: number): string {
  if (messages.length === 0) {
    return "No earlier social chat.";
  }

  const senderCounts = countBy(messages.map((message) => message.senderId));
  const topicCounts = countBy(messages.map((message) => message.topic ?? "general"));
  const urgent = messages.filter((message) => (message.urgency ?? 1) >= 4).length;
  const privateCount = messages.filter((message) => message.visibility !== "public").length;
  const topSenders = topEntries(senderCounts, 4);
  const topTopics = topEntries(topicCounts, 4);
  const first = messages[0]?.timestamp;
  const last = messages[messages.length - 1]?.timestamp;

  const summary = [
    `${messages.length} earlier messages`,
    first && last ? `from ${first} to ${last}` : undefined,
    topSenders.length > 0 ? `top senders: ${topSenders.join(", ")}` : undefined,
    topTopics.length > 0 ? `topics: ${topTopics.join(", ")}` : undefined,
    `${privateCount} private`,
    urgent > 0 ? `${urgent} urgent` : undefined,
  ].filter(Boolean).join("; ");

  if (summary.length <= maxLength) {
    return summary;
  }
  return `${summary.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function topEntries(counts: Map<string, number>, limit: number): string[] {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value}(${count})`);
}
