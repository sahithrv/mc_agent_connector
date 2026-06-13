import type { AgentConfig, AiChatMessage, GameEvent } from "@mc-ai-video/contracts";

import type { LlmProviderRegistry } from "../providers";
import type { LlmError, LlmRequest, LlmUsage } from "../providers/types";
import {
  ACTION_PARAMETER_RULES,
  buildDecisionPrompt,
  buildPersonaSystemPrompt,
  buildPromptContext,
  type ActiveScenarioContext,
  type ActionResultContext,
  type DynamicAgentState,
  type MemoryContext,
  type PromptPerceptionSnapshot,
  type RelationshipContext,
  type StaticPersona,
} from "../prompts";
import { AgentDecisionSchema, type AgentDecision } from "../schemas/agent-decision";
import {
  validateAgentDecisionContract,
  type DecisionRejection,
} from "./contract";
import { fallbackDecision } from "./fallback";
import {
  allowedDecisionActionsForAgent,
  promptActionDescriptions,
} from "./intent-map";

export interface DecisionModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

export interface AgentDecisionServiceInput {
  agent: Pick<AgentConfig, "id" | "name" | "role" | "team" | "subteam" | "leader" | "routine" | "allowedActions">;
  model: DecisionModelConfig;
  staticPersona: StaticPersona;
  dynamicState?: DynamicAgentState;
  perception?: PromptPerceptionSnapshot;
  relationships?: RelationshipContext[];
  memories?: MemoryContext[];
  recentActionResults?: ActionResultContext[];
  recentChat?: AiChatMessage[];
  recentEvents?: GameEvent[];
  activeScenario?: ActiveScenarioContext;
  availableActions?: AgentDecision["action"][];
  constraints?: string[];
  maxContextChars?: number;
}

export interface AgentDecisionServiceResult {
  decision: AgentDecision;
  fallback: boolean;
  repaired?: boolean;
  fallbackReason?: string;
  rejection?: DecisionRejection;
  usage?: LlmUsage;
  request: LlmRequest;
}

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 10_000;

export class AgentDecisionService {
  public constructor(private readonly providers: LlmProviderRegistry) {}

  public async decide(input: AgentDecisionServiceInput): Promise<AgentDecisionServiceResult> {
    const context = buildPromptContext({
      agent: input.agent,
      staticPersona: input.staticPersona,
      dynamicState: input.dynamicState,
      perception: input.perception,
      relationships: input.relationships,
      memories: input.memories,
      recentActionResults: input.recentActionResults,
      recentChat: input.recentChat,
      recentEvents: input.recentEvents,
      activeScenario: input.activeScenario,
      maxChars: input.maxContextChars,
    });
    const availableActions = input.availableActions ?? allowedDecisionActionsForAgent(input.agent);
    const request: LlmRequest = {
      provider: input.model.provider,
      model: input.model.model,
      system: buildPersonaSystemPrompt(input.staticPersona),
      messages: [{
        role: "user",
        content: buildDecisionPrompt({
          context,
          availableActions: promptActionDescriptions(availableActions),
          constraints: input.constraints,
        }),
      }],
      schemaName: "AgentDecision",
      temperature: input.model.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: input.model.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };

    const result = await this.providers.generateStructured(request, AgentDecisionSchema);
    if (!result.ok) {
      const reason = providerErrorReason(result.error);
      if (result.error.code === "schema_validation_failed") {
        const repaired = await this.repairDecision({
          input,
          request,
          availableActions,
          reason,
        });
        if (repaired) {
          return repaired;
        }
      }
      return this.withFallback(input, request, availableActions, reason, {
        code: result.error.code,
        message: reason,
      });
    }

    const parsed = AgentDecisionSchema.safeParse(result.value);
    if (!parsed.success) {
      const reason = schemaErrorReason(parsed.error.issues);
      const repaired = await this.repairDecision({
        input,
        request,
        availableActions,
        reason,
        previousDecision: result.value,
      });
      if (repaired) {
        return repaired;
      }
      return this.withFallback(input, request, availableActions, reason);
    }

    const contract = validateAgentDecisionContract({
      decision: parsed.data,
      availableActions,
    });
    if (!contract.ok) {
      const repaired = await this.repairDecision({
        input,
        request,
        availableActions,
        reason: contract.rejection.message,
        previousDecision: parsed.data,
      });
      if (repaired) {
        return repaired;
      }
      return this.withFallback(
        input,
        request,
        availableActions,
        contract.rejection.message,
        contract.rejection,
      );
    }

    return {
      decision: parsed.data,
      fallback: false,
      usage: result.usage,
      request,
    };
  }

  private withFallback(
    input: AgentDecisionServiceInput,
    request: LlmRequest,
    availableActions: AgentDecision["action"][],
    reason: string,
    rejection?: DecisionRejection,
  ): AgentDecisionServiceResult {
    return {
      decision: fallbackDecision({
        agent: input.agent,
        reason,
        perception: input.perception,
        dynamicState: input.dynamicState,
        recentActionResults: input.recentActionResults,
        recentChat: input.recentChat,
        recentEvents: input.recentEvents,
        availableActions,
      }),
      fallback: true,
      fallbackReason: reason,
      rejection,
      request,
    };
  }

  private async repairDecision(input: {
    input: AgentDecisionServiceInput;
    request: LlmRequest;
    availableActions: AgentDecision["action"][];
    reason: string;
    previousDecision?: unknown;
  }): Promise<AgentDecisionServiceResult | undefined> {
    const repairRequest: LlmRequest = {
      ...input.request,
      messages: [
        ...input.request.messages,
        {
          role: "user",
          content: buildDecisionRepairPrompt({
            reason: input.reason,
            previousDecision: input.previousDecision,
            availableActions: input.availableActions,
          }),
        },
      ],
    };

    const result = await this.providers.generateStructured(repairRequest, AgentDecisionSchema);
    if (!result.ok) {
      return undefined;
    }

    const parsed = AgentDecisionSchema.safeParse(result.value);
    if (!parsed.success) {
      return undefined;
    }

    const contract = validateAgentDecisionContract({
      decision: parsed.data,
      availableActions: input.availableActions,
    });
    if (!contract.ok) {
      return undefined;
    }

    return {
      decision: parsed.data,
      fallback: false,
      repaired: true,
      usage: result.usage,
      request: repairRequest,
    };
  }
}

function providerErrorReason(error: LlmError): string {
  return `${error.code}: ${error.message}`;
}

function buildDecisionRepairPrompt(input: {
  reason: string;
  previousDecision?: unknown;
  availableActions: AgentDecision["action"][];
}): string {
  return [
    `Your previous AgentDecision was rejected: ${input.reason}.`,
    input.previousDecision !== undefined
      ? [
          "",
          "PREVIOUS_REJECTED_DECISION",
          safeJsonPreview(input.previousDecision),
        ].join("\n")
      : undefined,
    "",
    "Return a corrected AgentDecision using only the listed actions.",
    "If no valid physical action can advance the goal, choose continue_routine or ask for help.",
    "Do not choose idle unless there is truly no progress action.",
    "",
    "AVAILABLE_ACTIONS",
    promptActionDescriptions(input.availableActions).join(", "),
    "",
    "ACTION_PARAMETER_RULES",
    ACTION_PARAMETER_RULES.map((rule) => `- ${rule}`).join("\n"),
    "",
    "Return only AgentDecision JSON with fields: intent, action, parameters, optional speech, confidence, reasoningSummary.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function schemaErrorReason(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  const summary = issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
    .join("; ");
  return summary ? `provider returned invalid AgentDecision: ${summary}` : "provider returned invalid AgentDecision";
}

function safeJsonPreview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length <= 1_500 ? text : `${text.slice(0, 1_497)}...`;
  } catch {
    return String(value);
  }
}
