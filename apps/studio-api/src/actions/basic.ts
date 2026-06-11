import type { ActionRequest } from "@mc-ai-video/contracts";

import { numberParam, stringArrayParam, stringParam } from "./params";
import { actionFailed, actionSucceeded } from "./result";
import type {
  ActionRuntimeContext,
  ActionRunContext,
  CanRunResult,
  RegisteredAction,
} from "./types";

const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_IDLE_MS = 60_000;
const DEFAULT_CHAT_TIMEOUT_MS = 3_000;
const DEFAULT_PUBLIC_CHAT_MAX_LENGTH = 256;
const DEFAULT_AI_CHAT_MAX_LENGTH = 2_000;
const DEFAULT_CHAT_COOLDOWN_MS = 1_000;

export function createIdleAction(): RegisteredAction {
  return {
    name: "idle",
    risk: "none",
    timeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    canRun: validateIdle,
    async run(context) {
      const durationMs = numberParam(context.request.params, "durationMs") ?? 1_000;
      try {
        await delay(durationMs, context.signal);
      } catch {
        return actionFailed(context.request, context.startedAt, "idle canceled");
      }
      return actionSucceeded(context.request, context.startedAt, { durationMs });
    },
  };
}

export function createChatPublicAction(): RegisteredAction {
  const lastSentAt = new Map<string, number>();

  return {
    name: "chat_public",
    risk: "low",
    timeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.bot) {
        return { ok: false, reason: "bot is not connected" };
      }
      return validateChatMessage(context, request, true);
    },
    async run(context) {
      const cooldownMs = context.policy?.chatCooldownMs ?? DEFAULT_CHAT_COOLDOWN_MS;
      const previousSentAt = lastSentAt.get(context.agent.id) ?? 0;
      const now = Date.now();
      if (now - previousSentAt < cooldownMs) {
        return actionFailed(
          context.request,
          context.startedAt,
          `chat cooldown active for ${cooldownMs - (now - previousSentAt)}ms`,
        );
      }

      const message = requireMessage(context.request);
      await Promise.resolve(context.bot?.chat(message));
      lastSentAt.set(context.agent.id, Date.now());
      return actionSucceeded(context.request, context.startedAt, { message });
    },
  };
}

export function createChatAiPrivateAction(): RegisteredAction {
  return {
    name: "chat_ai_private",
    risk: "low",
    timeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
    canRun(context, request) {
      if (!context.chatBus) {
        return { ok: false, reason: "AI chat bus is not configured" };
      }
      return validateChatMessage(context, request, false);
    },
    async run(context) {
      const recipientIds = recipientsFromRequest(context.request);
      if (recipientIds.length === 0) {
        return actionFailed(context.request, context.startedAt, "recipientIds required");
      }

      const message = requireMessage(context.request);
      const published = await context.chatBus?.publish({
        senderId: context.agent.id,
        recipientIds,
        topic: stringParam(context.request.params, "topic"),
        visibility: "ai",
        content: message,
      });

      return actionSucceeded(context.request, context.startedAt, {
        messageId: published?.id ?? "",
        recipientCount: recipientIds.length,
      });
    },
  };
}

function validateIdle(
  context: ActionRuntimeContext,
  request: ActionRequest,
): CanRunResult {
  const durationMs = numberParam(request.params, "durationMs") ?? 1_000;
  const maxIdleMs = context.policy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > maxIdleMs) {
    return { ok: false, reason: `durationMs must be between 0 and ${maxIdleMs}` };
  }
  return { ok: true };
}

function validateChatMessage(
  context: ActionRuntimeContext,
  request: ActionRequest,
  publicChat: boolean,
): CanRunResult {
  const message = stringParam(request.params, "message")
    ?? stringParam(request.params, "content");
  const maxLength = publicChat
    ? context.policy?.publicChatMaxLength ?? DEFAULT_PUBLIC_CHAT_MAX_LENGTH
    : context.policy?.aiChatMaxLength ?? DEFAULT_AI_CHAT_MAX_LENGTH;

  if (!message || message.trim().length === 0) {
    return { ok: false, reason: "message must be non-empty" };
  }
  if (message.length > maxLength) {
    return { ok: false, reason: `message exceeds ${maxLength} characters` };
  }
  return { ok: true };
}

function recipientsFromRequest(request: ActionRequest): string[] {
  return stringArrayParam(request.params, "recipientIds")
    ?? stringArrayParam(request.params, "recipients")
    ?? (stringParam(request.params, "recipientId")
      ? [stringParam(request.params, "recipientId") as string]
      : []);
}

function requireMessage(request: ActionRequest): string {
  return stringParam(request.params, "message")
    ?? stringParam(request.params, "content")
    ?? "";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
