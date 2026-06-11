import test from "node:test";
import assert from "node:assert/strict";

import type { AiChatMessage } from "@mc-ai-video/contracts";

import { createDefaultActionRegistry } from "./index";
import { actionRequest, fakeAgent, fakeBot } from "./test-helpers";
import type { AiChatPublishInput } from "./types";

test("ActionRegistry rejects unknown actions", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("dance"),
    { agent: fakeAgent() },
  );

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /unknown action/);
});

test("idle returns success after duration", async () => {
  const result = await createDefaultActionRegistry().run(
    actionRequest("idle", { durationMs: 1 }, 50),
    { agent: fakeAgent() },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.durationMs, 1);
});

test("chat_ai_private writes to backend chat bus", async () => {
  const published: AiChatPublishInput[] = [];
  const chatBus = {
    publish(message: AiChatPublishInput): AiChatMessage {
      published.push(message);
      return {
        id: "chat-1",
        timestamp: "2026-06-10T00:00:00.000Z",
        ...message,
      };
    },
  };

  const result = await createDefaultActionRegistry().run(
    actionRequest("chat_ai_private", {
      message: "Need help at the farm",
      recipientIds: ["agent-b"],
    }),
    { agent: fakeAgent(), chatBus },
  );

  assert.equal(result.ok, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.senderId, "agent-a");
  assert.deepEqual(published[0]?.recipientIds, ["agent-b"]);
});

test("chat_public validates length and cooldown", async () => {
  const messages: string[] = [];
  const registry = createDefaultActionRegistry();
  const context = {
    agent: fakeAgent(),
    bot: fakeBot({
      chat(message: string) {
        messages.push(message);
      },
    }),
    policy: {
      publicChatMaxLength: 5,
      chatCooldownMs: 1_000,
    },
  };

  const tooLong = await registry.run(
    actionRequest("chat_public", { message: "too long" }),
    context,
  );
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error ?? "", /exceeds/);

  const first = await registry.run(actionRequest("chat_public", { message: "hi" }), context);
  const second = await registry.run(actionRequest("chat_public", { message: "yo" }), context);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error ?? "", /cooldown/);
  assert.deepEqual(messages, ["hi"]);
});
