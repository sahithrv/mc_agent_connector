import type { ZodType } from "zod";

import { llmError, type LlmProvider, type LlmRequest, type LlmResult } from "./types";

export class UnsupportedLlmProvider implements LlmProvider {
  public constructor(
    public readonly name: string,
    private readonly message: string,
  ) {}

  public async generateStructured<T>(
    _request: LlmRequest,
    _schema: ZodType<T>,
  ): Promise<LlmResult<T>> {
    return llmError("provider_unsupported", this.message, false);
  }
}
