import type { AiSpeechProposal } from "../schemas";

export interface SpeechGuardOptions {
  maxLength?: number;
  fallbackContent?: string;
}

export type SpeechGuardResult =
  | { ok: true; proposal: AiSpeechProposal }
  | { ok: false; reason: string; proposal?: AiSpeechProposal };

const DEFAULT_MAX_LENGTH = 180;
const DEFAULT_FALLBACK = "I need a moment to think.";

const REASONING_PATTERNS = [
  /chain[- ]?of[- ]?thought/i,
  /scratchpad/i,
  /private reasoning/i,
  /internal reasoning/i,
  /hidden reasoning/i,
  /reasoningSummary/i,
  /step[- ]by[- ]step/i,
  /<\s*thinking[\s\S]*?>/i,
  /<\s*\/\s*thinking\s*>/i,
];

export function guardSpeechProposal(
  proposal: AiSpeechProposal,
  options: SpeechGuardOptions = {},
): SpeechGuardResult {
  const normalized = normalizeSpeechText(proposal.content, options.maxLength);
  if (!normalized) {
    return { ok: false, reason: "speech content is empty after normalization" };
  }

  if (containsPrivateReasoning(normalized)) {
    const fallback = normalizeSpeechText(
      options.fallbackContent ?? DEFAULT_FALLBACK,
      options.maxLength,
    );
    return {
      ok: false,
      reason: "speech content appears to expose private reasoning",
      proposal: { ...proposal, content: fallback },
    };
  }

  return { ok: true, proposal: { ...proposal, content: normalized } };
}

export function normalizeSpeechText(
  content: string,
  maxLength = DEFAULT_MAX_LENGTH,
): string {
  const compact = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  const clipped = compact.slice(0, Math.max(0, maxLength - 1)).trimEnd();
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?"),
  );
  if (sentenceEnd >= Math.floor(maxLength * 0.45)) {
    return clipped.slice(0, sentenceEnd + 1);
  }
  return `${clipped.replace(/[,.!?;:]+$/, "")}...`;
}

export function containsPrivateReasoning(content: string): boolean {
  return REASONING_PATTERNS.some((pattern) => pattern.test(content));
}
