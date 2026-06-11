import { OpenAiCompatibleProvider, type OpenAiCompatibleChatClient } from "./openai-compatible";
import type { ProviderEndpointConfig } from "./config";

export function createOpenAiProvider(
  config: ProviderEndpointConfig,
  client?: OpenAiCompatibleChatClient,
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    providerName: "openai",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    defaultModel: config.defaultModel,
  }, client);
}
