import type { AgentConfig, AiChatMessage, GameEvent } from "@mc-ai-video/contracts";

import type { LlmProviderRegistry } from "../providers";
import type { LlmError, LlmRequest, LlmUsage } from "../providers/types";
import {
  buildDecisionPrompt,
  buildPersonaSystemPrompt,
  buildPromptContext,
  type ActiveScenarioContext,
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
      return this.withFallback(input, request, availableActions, reason, {
        code: result.error.code,
        message: reason,
      });
    }

    const parsed = AgentDecisionSchema.safeParse(result.value);
    if (!parsed.success) {
      return this.withFallback(input, request, availableActions, "provider returned invalid AgentDecision");
    }

    const contract = validateAgentDecisionContract({
      decision: parsed.data,
      availableActions,
    });
    if (!contract.ok) {
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
}

function providerErrorReason(error: LlmError): string {
  return `${error.code}: ${error.message}`;
}
