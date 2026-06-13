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
    ...actionMetadata(request),
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
    ...actionMetadata(request),
  };
}

function actionMetadata(request: ActionRequest): Pick<ActionResult, "params" | "requestedBy" | "source" | "targetKey"> {
  return {
    params: request.params,
    requestedBy: request.requestedBy,
    source: request.source,
    targetKey: request.targetKey,
  };
}
