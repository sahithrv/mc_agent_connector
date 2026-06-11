export interface ProviderEndpointConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface LlmProviderConfig {
  openai: ProviderEndpointConfig;
  anthropic: ProviderEndpointConfig;
  deepseek: ProviderEndpointConfig;
  openrouter: ProviderEndpointConfig;
  local: ProviderEndpointConfig;
}

export function loadLlmProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmProviderConfig {
  return {
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      defaultModel: env.OPENAI_MODEL,
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      defaultModel: env.ANTHROPIC_MODEL,
    },
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      defaultModel: env.DEEPSEEK_MODEL,
    },
    openrouter: {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      defaultModel: env.OPENROUTER_MODEL,
    },
    local: {
      baseUrl: env.LOCAL_LLM_BASE_URL,
      defaultModel: env.LOCAL_LLM_MODEL,
    },
  };
}
