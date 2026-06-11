export type LlmModelLane = "cheap" | "premium";

export type LlmTaskType =
  | "routine_speech"
  | "routine_reflection"
  | "decision"
  | "leader_planning"
  | "major_moment"
  | "director_intervention";

export interface LlmModelSpec {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export type LlmModelSpecInput = Partial<LlmModelSpec>;

export interface AgentModelConfig {
  default?: LlmModelSpecInput;
  lanes?: Partial<Record<LlmModelLane, LlmModelSpecInput>>;
}

export interface LlmModelConfigMatrix {
  default?: LlmModelSpecInput;
  lanes: Partial<Record<LlmModelLane, LlmModelSpecInput>>;
  agents?: Record<string, AgentModelConfig>;
}

export interface ResolveModelConfigInput {
  matrix: LlmModelConfigMatrix;
  agentId: string;
  taskType: LlmTaskType;
  isLeader?: boolean;
}

const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 1024;

export function selectModelLane(taskType: LlmTaskType, isLeader = false): LlmModelLane {
  if (isLeader || taskType === "leader_planning" || taskType === "major_moment" || taskType === "director_intervention") {
    return "premium";
  }
  return "cheap";
}

export function resolveModelConfig(input: ResolveModelConfigInput): LlmModelSpec {
  const lane = selectModelLane(input.taskType, input.isLeader);
  const agent = input.matrix.agents?.[input.agentId];
  const merged = mergeSpecs(
    input.matrix.default,
    input.matrix.lanes[lane],
    agent?.default,
    agent?.lanes?.[lane],
  );

  return normalizeModelSpec(merged, `agent ${input.agentId} ${lane} lane`);
}

export function validateModelConfigMatrix(
  matrix: LlmModelConfigMatrix,
  agentIds: string[] = Object.keys(matrix.agents ?? {}),
): void {
  const lanes: LlmModelLane[] = ["cheap", "premium"];
  for (const lane of lanes) {
    normalizeModelSpec(mergeSpecs(matrix.default, matrix.lanes[lane]), `${lane} lane`);
  }

  for (const agentId of agentIds) {
    for (const lane of lanes) {
      resolveModelConfig({
        matrix,
        agentId,
        taskType: lane === "cheap" ? "routine_speech" : "major_moment",
      });
    }
  }
}

function mergeSpecs(...specs: Array<LlmModelSpecInput | undefined>): LlmModelSpecInput {
  return specs.reduce<LlmModelSpecInput>(
    (merged, spec) => ({ ...merged, ...(spec ?? {}) }),
    {},
  );
}

function normalizeModelSpec(spec: LlmModelSpecInput, label: string): LlmModelSpec {
  if (!spec.provider || spec.provider.trim().length === 0) {
    throw new Error(`LLM model config missing provider for ${label}`);
  }
  if (!spec.model || spec.model.trim().length === 0) {
    throw new Error(`LLM model config missing model for ${label}`);
  }
  return {
    provider: spec.provider,
    model: spec.model,
    temperature: validNumber(spec.temperature, DEFAULT_TEMPERATURE, `temperature for ${label}`),
    maxTokens: validInteger(spec.maxTokens, DEFAULT_MAX_TOKENS, `maxTokens for ${label}`),
  };
}

function validNumber(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`LLM model config invalid ${label}`);
  }
  return value;
}

function validInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`LLM model config invalid ${label}`);
  }
  return value;
}
