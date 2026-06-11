import type { ZodType } from "zod";

import { AnthropicProvider } from "./anthropic";
import { loadLlmProviderConfig, type LlmProviderConfig } from "./config";
import { createDeepSeekProvider } from "./deepseek";
import { createOpenAiProvider } from "./openai";
import { UnsupportedLlmProvider } from "./unsupported";
import { llmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  public register(provider: LlmProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`LLM provider already registered: ${provider.name}`);
    }
    this.providers.set(provider.name, provider);
  }

  public get(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  public async generateStructured<T>(
    request: LlmRequest,
    schema: ZodType<T>,
  ): Promise<LlmResult<T>> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      return llmError("unknown_provider", `unknown LLM provider: ${request.provider}`, false);
    }
    return provider.generateStructured(request, schema);
  }
}

export function createDefaultLlmProviderRegistry(
  config: LlmProviderConfig = loadLlmProviderConfig(),
): LlmProviderRegistry {
  const registry = new LlmProviderRegistry();
  registry.register(createOpenAiProvider(config.openai));
  registry.register(new AnthropicProvider(config.anthropic));
  registry.register(createDeepSeekProvider(config.deepseek));
  registry.register(new UnsupportedLlmProvider(
    "local",
    "local LLM provider is not implemented; configure a local adapter before use",
  ));
  registry.register(new UnsupportedLlmProvider(
    "openrouter",
    "OpenRouter provider placeholder is not implemented; use openai, anthropic, or deepseek",
  ));
  return registry;
}
