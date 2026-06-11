import { z } from "zod";

export const AiChatMessageProposalSchema = z.object({
  senderId: z.string().trim().min(1).max(128),
  recipientIds: z.array(z.string().trim().min(1).max(128)).min(1).max(20),
  visibility: z.enum(["ai", "human-team"]),
  content: z.string().trim().min(1).max(2048),
  topic: z.string().trim().min(1).max(128).optional(),
  urgency: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
}).strict();

export type AiChatMessageProposal = z.infer<typeof AiChatMessageProposalSchema>;
