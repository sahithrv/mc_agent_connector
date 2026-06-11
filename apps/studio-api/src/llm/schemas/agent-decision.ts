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
  "attack_entity",
]);

export const AiSpeechProposalSchema = z.object({
  visibility: z.enum(["public", "ai"]),
  content: z.string().trim().min(1).max(300),
  recipientIds: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  topic: z.string().trim().min(1).max(128).optional(),
}).superRefine((proposal, context) => {
  if (proposal.visibility === "ai" && (!proposal.recipientIds || proposal.recipientIds.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientIds"],
      message: "private AI speech requires at least one recipient",
    });
  }
  if (proposal.visibility === "public" && proposal.recipientIds && proposal.recipientIds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipientIds"],
      message: "public speech cannot include private recipients",
    });
  }
});

export const AgentDecisionSchema = z.object({
  intent: z.string().trim().min(1).max(120),
  action: AgentDecisionActionSchema,
  parameters: JsonRecordSchema.default({}),
  speech: AiSpeechProposalSchema.optional(),
  confidence: z.number().finite().min(0).max(1),
  reasoningSummary: z.string().trim().min(1).max(240),
}).strict();

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type AiSpeechProposal = z.infer<typeof AiSpeechProposalSchema>;
