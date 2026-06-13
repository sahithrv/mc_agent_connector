import { z } from "zod";

import { JsonRecordSchema } from "./json";

export const AgentDecisionActionSchema = z.enum([
  "idle",
  "continue_routine",
  "chat_public",
  "chat_ai_private",
  "move_to",
  "follow_player",
  "flee",
  "collect_item",
  "mine_block",
  "craft_item",
  "place_block",
  "attack_entity",
]);

export const AiSpeechProposalSchema = z.preprocess(normalizeSpeech, z.object({
  visibility: z.preprocess(normalizeVisibility, z.enum(["public", "ai"])),
  content: z.string().trim().min(1).max(300),
  recipientIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  topic: z.string().trim().min(1).max(128).optional(),
}));

export const AgentDecisionSchema = z.preprocess(normalizeDecision, z.object({
  intent: z.string().trim().min(1).max(120),
  action: AgentDecisionActionSchema,
  parameters: JsonRecordSchema.default({}),
  speech: AiSpeechProposalSchema.optional(),
  confidence: z.number().finite().min(0).max(1),
  reasoningSummary: z.string().trim().min(1).max(240),
}));

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type AiSpeechProposal = z.infer<typeof AiSpeechProposalSchema>;

function normalizeDecision(value: unknown): unknown {
  const root = objectValue(value);
  if (!root) {
    return value;
  }

  const wrapped = objectValue(root.decision) ?? objectValue(root.agentDecision) ?? objectValue(root.result);
  const source = wrapped ?? root;
  return {
    ...source,
    parameters: source.parameters ?? source.params ?? {},
    speech: source.speech ?? undefined,
    reasoningSummary: source.reasoningSummary ?? source.reasoning_summary ?? source.summary ?? source.reasoning,
  };
}

function normalizeSpeech(value: unknown): unknown {
  if (typeof value === "string") {
    return {
      visibility: "public",
      content: value,
    };
  }

  const source = objectValue(value);
  if (!source) {
    return value;
  }

  return {
    ...source,
    visibility: source.visibility ?? publicFlagToVisibility(source.public),
    recipientIds: source.recipientIds ?? source.recipient_ids ?? source.recipients,
    content: source.content ?? source.message ?? source.text,
  };
}

function publicFlagToVisibility(value: unknown): unknown {
  if (typeof value !== "boolean") {
    return undefined;
  }
  return value ? "public" : "ai";
}

function normalizeVisibility(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.toLowerCase().replace(/[-\s]/g, "_");
  if (["ai", "ai_only", "private", "ai_private", "private_ai", "team", "team_private"].includes(normalized)) {
    return "ai";
  }
  if (["public", "global", "chat_public"].includes(normalized)) {
    return "public";
  }
  return value;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
