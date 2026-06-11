import type { ActionRequest, ActionResult, JsonValue } from "@mc-ai-video/contracts";

export function actionSucceeded(
  request: ActionRequest,
  startedAt: string,
  data?: Record<string, JsonValue>,
): ActionResult {
  return {
    requestId: request.id,
    agentId: request.agentId,
    action: request.action,
    ok: true,
    startedAt,
    completedAt: new Date().toISOString(),
    data,
  };
}

export function actionFailed(
  request: ActionRequest,
  startedAt: string,
  error: string,
  data?: Record<string, JsonValue>,
): ActionResult {
  return {
    requestId: request.id,
    agentId: request.agentId,
    action: request.action,
    ok: false,
    startedAt,
    completedAt: new Date().toISOString(),
    error,
    data,
  };
}
