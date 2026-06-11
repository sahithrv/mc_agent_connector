import { z } from "zod";

const RelationshipValueSchema = z.number().finite().transform((value) =>
  Math.max(0, Math.min(100, value)),
);

export const RelationshipReflectionSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
  trust: RelationshipValueSchema,
  loyalty: RelationshipValueSchema,
  fear: RelationshipValueSchema,
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
}).strict();

export const ReflectionResultSchema = z.object({
  emotionalState: z.string().trim().min(1).max(80),
  relationships: z.array(RelationshipReflectionSchema).max(20).default([]),
  newGoals: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
  memorySummary: z.string().trim().min(1).max(500),
  reasoningSummary: z.string().trim().min(1).max(240),
}).strict();

export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
export type RelationshipReflection = z.infer<typeof RelationshipReflectionSchema>;
