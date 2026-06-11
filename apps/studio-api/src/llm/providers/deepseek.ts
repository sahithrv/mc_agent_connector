import { OpenAiCompatibleProvider, type OpenAiCompatibleChatClient } from "./openai-compatible";
import type { ProviderEndpointConfig } from "./config";

export function createDeepSeekProvider(
  config: ProviderEndpointConfig,
  client?: OpenAiCompatibleChatClient,
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    providerName: "deepseek",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    defaultModel: config.defaultModel,
  }, client);
}
