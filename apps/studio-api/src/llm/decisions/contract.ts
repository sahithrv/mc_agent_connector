import type { AgentDecision } from "../schemas/agent-decision";
import { isAllowedDecisionAction } from "./intent-map";

export interface DecisionRejection {
  code: string;
  message: string;
  action?: AgentDecision["action"];
  path?: string;
}

export type DecisionContractResult =
  | { ok: true }
  | { ok: false; rejection: DecisionRejection };

export interface ValidateAgentDecisionContractInput {
  decision: AgentDecision;
  availableActions: readonly AgentDecision["action"][];
}

export function validateAgentDecisionContract(
  input: ValidateAgentDecisionContractInput,
): DecisionContractResult {
  const { decision, availableActions } = input;
  if (!isAllowedDecisionAction(decision.action, availableActions)) {
    return reject(
      "unavailable_action",
      `provider chose unavailable action: ${decision.action}`,
      decision.action,
      "action",
    );
  }

  const params = decision.parameters;
  switch (decision.action) {
    case "idle":
      return validateOptionalPositiveNumber(decision, "durationMs", { allowZero: true, max: 60_000 });
    case "continue_routine":
      return validateOptionalString(decision, "routineId");
    case "chat_public":
      if (decision.speech?.visibility === "ai") {
        return reject("speech_visibility_mismatch", "chat_public cannot use ai-private speech", decision.action, "speech.visibility");
      }
      return requireMessage(decision);
    case "chat_ai_private":
      if (decision.speech?.visibility === "public") {
        return reject("speech_visibility_mismatch", "chat_ai_private cannot use public speech", decision.action, "speech.visibility");
      }
      return requireMessage(decision);
    case "move_to":
      return hasPosition(params)
        ? validateOptionalPositiveNumber(decision, "range", { allowZero: false, max: 64 })
        : reject("missing_parameter", "move_to requires position or x/y/z parameters", decision.action, "parameters.position");
    case "follow_player":
      return hasAnyString(params, ["username", "player", "target"])
        ? validateOptionalPositiveNumber(decision, "range", { allowZero: false, max: 64 })
        : reject("missing_parameter", "follow_player requires username, player, or target", decision.action, "parameters.username");
    case "flee":
      if (!hasPosition(params) && !hasAnyString(params, ["entityId", "username", "player", "target"])) {
        return reject("missing_parameter", "flee requires position, entityId, username, or target", decision.action, "parameters");
      }
      return validateOptionalPositiveNumber(decision, "distance", { allowZero: false, max: 64 });
    case "collect_item":
      return hasAnyString(params, ["entityId", "item", "name"])
        ? ok()
        : reject("missing_parameter", "collect_item requires entityId, item, or name", decision.action, "parameters.entityId");
    case "mine_block":
      return hasPosition(params)
        ? ok()
        : reject("missing_parameter", "mine_block requires block position or x/y/z parameters", decision.action, "parameters.position");
    case "craft_item":
      return hasAnyString(params, ["item", "name", "block"])
        ? validateOptionalPositiveNumber(decision, "count", { allowZero: false, max: 64 })
        : reject("missing_parameter", "craft_item requires item, name, or block", decision.action, "parameters.item");
    case "place_block":
      return hasPosition(params)
        ? ok()
        : reject("missing_parameter", "place_block requires target position or x/y/z parameters", decision.action, "parameters.position");
    case "attack_entity":
      return hasAnyString(params, ["entityId", "username", "name", "target"])
        ? ok()
        : reject("missing_parameter", "attack_entity requires entityId, username, name, or target", decision.action, "parameters.entityId");
  }
}

function requireMessage(decision: AgentDecision): DecisionContractResult {
  if (decision.speech?.content || hasAnyString(decision.parameters, ["message", "content"])) {
    return ok();
  }
  return reject(
    "missing_parameter",
    `${decision.action} requires speech.content, message, or content`,
    decision.action,
    "parameters.message",
  );
}

function validateOptionalString(
  decision: AgentDecision,
  field: string,
): DecisionContractResult {
  const value = decision.parameters[field];
  if (value === undefined || typeof value === "string" && value.trim().length > 0) {
    return ok();
  }
  return reject("invalid_parameter", `${field} must be a non-empty string when provided`, decision.action, `parameters.${field}`);
}

function validateOptionalPositiveNumber(
  decision: AgentDecision,
  field: string,
  options: { allowZero: boolean; max: number },
): DecisionContractResult {
  const value = decision.parameters[field];
  if (value === undefined) {
    return ok();
  }
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && (options.allowZero ? value >= 0 : value > 0)
    && value <= options.max
  ) {
    return ok();
  }
  const lower = options.allowZero ? "0" : "greater than 0";
  return reject(
    "invalid_parameter",
    `${field} must be ${lower} and <= ${options.max} when provided`,
    decision.action,
    `parameters.${field}`,
  );
}

function hasAnyString(params: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => typeof params[key] === "string" && params[key].trim().length > 0);
}

function hasNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function hasPosition(params: Record<string, unknown>): boolean {
  if (isPosition(params.position)) {
    return true;
  }
  return hasNumber(params.x) && hasNumber(params.y) && hasNumber(params.z);
}

function isPosition(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  return hasNumber(source.x) && hasNumber(source.y) && hasNumber(source.z);
}

function reject(
  code: string,
  message: string,
  action?: AgentDecision["action"],
  path?: string,
): DecisionContractResult {
  return { ok: false, rejection: { code, message, action, path } };
}

function ok(): DecisionContractResult {
  return { ok: true };
}
