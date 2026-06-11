import type { ActionRequest, ActionResult } from "@mc-ai-video/contracts";

import { actionFailed } from "./result";
import type {
  ActionRuntimeContext,
  ActionRunContext,
  RegisteredAction,
} from "./types";

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();

  register(action: RegisteredAction): void {
    if (this.actions.has(action.name)) {
      throw new Error(`action already registered: ${action.name}`);
    }
    this.actions.set(action.name, action);
  }

  get(actionName: string): RegisteredAction | undefined {
    return this.actions.get(actionName);
  }

  list(): RegisteredAction[] {
    return Array.from(this.actions.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async run(
    request: ActionRequest,
    context: ActionRuntimeContext,
  ): Promise<ActionResult> {
    const startedAt = new Date().toISOString();
    const action = this.actions.get(request.action);
    if (!action) {
      return actionFailed(request, startedAt, `unknown action: ${request.action}`);
    }

    if (!context.agent.allowedActions.includes(action.name)) {
      return actionFailed(
        request,
        startedAt,
        `action not allowed for agent: ${action.name}`,
      );
    }

    const timeoutMs = resolveTimeout(request.timeoutMs, action.timeoutMs);
    if (timeoutMs === undefined) {
      return actionFailed(request, startedAt, "timeoutMs must be a positive integer");
    }

    const canRun = action.canRun(context, request);
    if (!canRun.ok) {
      return actionFailed(request, startedAt, canRun.reason);
    }

    const controller = new AbortController();
    const runContext: ActionRunContext = {
      ...context,
      request,
      startedAt,
      signal: controller.signal,
    };

    return this.runWithTimeout(action, runContext, timeoutMs, controller);
  }

  private async runWithTimeout(
    action: RegisteredAction,
    context: ActionRunContext,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<ActionResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ActionResult>((resolve) => {
      timer = setTimeout(() => {
        const result = actionFailed(
          context.request,
          context.startedAt,
          `action timed out after ${timeoutMs}ms`,
          { status: "timed_out" },
        );
        resolve(result);
        controller.abort(result.error);
      }, timeoutMs);
    });

    const execution = action.run(context).catch((error: unknown) =>
      actionFailed(context.request, context.startedAt, formatError(error)),
    );

    try {
      return await Promise.race([execution, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

function resolveTimeout(
  requestedMs: number | undefined,
  actionDefaultMs: number,
): number | undefined {
  if (requestedMs !== undefined) {
    if (!Number.isInteger(requestedMs) || requestedMs <= 0) {
      return undefined;
    }
    return Math.min(requestedMs, actionDefaultMs);
  }
  return actionDefaultMs;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
