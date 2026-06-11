import assert from "node:assert/strict";
import test from "node:test";

import type { AiChatMessage } from "@mc-ai-video/contracts";

import { excludeRecorderSocialMessages, summarizeMultiAgentChat } from "./index";

test("recorder-only messages are excluded from normal social chat context", () => {
  const messages = [
    message("recorder", ["farmer"], "Please look at camera"),
    message("farmer", ["recorder"], "Camera acknowledged"),
    message("farmer", ["miner"], "Need wheat"),
  ];

  const social = excludeRecorderSocialMessages(messages, ["recorder"]);

  assert.deepEqual(social.map((item) => item.content), ["Need wheat"]);
});

test("100 chat messages summarize into short context plus last few messages", () => {
  const messages = Array.from({ length: 100 }, (_, index) =>
    message(
      index % 2 === 0 ? "farmer" : "miner",
      ["leader"],
      `message ${index}`,
      index % 3 === 0 ? "food" : "mining",
    ),
  );

  const context = summarizeMultiAgentChat(messages, {
    maxRecentMessages: 5,
    maxSummaryLength: 220,
  });

  assert.equal(context.originalCount, 100);
  assert.equal(context.consideredCount, 100);
  assert.equal(context.recentMessages.length, 5);
  assert.ok(context.summary.length <= 220);
  assert.match(context.summary, /95 earlier messages/);
  assert.deepEqual(context.recentMessages.map((item) => item.content), [
    "message 95",
    "message 96",
    "message 97",
    "message 98",
    "message 99",
  ]);
});

function message(
  senderId: string,
  recipientIds: string[],
  content: string,
  topic = "general",
): AiChatMessage {
  return {
    id: `${senderId}-${content}`,
    senderId,
    recipientIds,
    visibility: "ai",
    topic,
    urgency: 2,
    content,
    timestamp: "2026-06-10T00:00:00.000Z",
  };
}
