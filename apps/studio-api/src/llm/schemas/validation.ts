import type { ZodType } from "zod";

import { llmError, type LlmResult, type LlmUsage } from "../providers/types";

export function validateStructuredOutput<T>(
  schemaName: string,
  schema: ZodType<T>,
  output: unknown,
  usage?: LlmUsage,
): LlmResult<T> {
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    return llmError(
      "schema_validation_failed",
      `${schemaName} validation failed: ${parsed.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}`,
      false,
    );
  }
  return usage ? { ok: true, value: parsed.data, usage } : { ok: true, value: parsed.data };
}

export function parseJsonObject(text: string): unknown {
  return JSON.parse(text) as unknown;
}
