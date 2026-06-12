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
    if (process.env.LLM_DEBUG_RAW === "1") {
      console.warn(
        `[llm-debug] invalid ${schemaName} output: ${safeJsonPreview(output)}`,
      );
    }
    return llmError(
      "schema_validation_failed",
      `${schemaName} validation failed: ${parsed.error.issues.map((issue) =>
        `${issue.path.join(".") || "root"} ${issue.message}`,
      ).join("; ")}`,
      false,
    );
  }
  return usage ? { ok: true, value: parsed.data, usage } : { ok: true, value: parsed.data };
}

export function parseJsonObject(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function safeJsonPreview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length <= 2_000 ? text : `${text.slice(0, 2_000)}...`;
  } catch {
    return String(value);
  }
}
