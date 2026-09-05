/**
 * INPUT:  Utility Slot summary text, source projection, finish metadata, and protected content markers
 * OUTPUT: bounded acceptance/rejection result for projection-only summary replacement
 * POS:    core/agents — Slice 4 quality guard; rejected output never advances a durable checkpoint
 */
import { estimateTokens } from "../memory/token-estimator.ts";

export type SummaryQualityCode = "accepted" | "blank" | "truncated" | "non_shrinking" | "forbidden_content" | "protected_content";

export interface SummaryQualityResult {
  accepted: boolean;
  code: SummaryQualityCode;
  text: string;
  sourceTokens: number;
  summaryTokens: number;
}

export function validateSummary(input: {
  text: string;
  sourceText: string;
  finishReason?: string;
  protectedContent?: string[];
  strictShrink?: boolean;
}): SummaryQualityResult {
  const text = input.text.trim();
  const sourceTokens = estimateTokens(input.sourceText);
  const summaryTokens = estimateTokens(text);
  if (text.length === 0) return makeResult({ code: "blank", text, sourceTokens, summaryTokens });
  if (input.finishReason === "length" || input.finishReason === "content-filter" || input.finishReason === "error")
    return makeResult({ code: "truncated", text, sourceTokens, summaryTokens });
  if (containsForbidden(text)) return makeResult({ code: "forbidden_content", text, sourceTokens, summaryTokens });
  if ((input.protectedContent ?? []).some((value) => value.length > 0 && text.includes(value)))
    return makeResult({ code: "protected_content", text, sourceTokens, summaryTokens });
  if ((input.strictShrink ?? true) && sourceTokens > 0 && summaryTokens >= sourceTokens)
    return makeResult({ code: "non_shrinking", text, sourceTokens, summaryTokens });
  return makeResult({ code: "accepted", text, sourceTokens, summaryTokens });
}

function makeResult(input: { code: SummaryQualityCode; text: string; sourceTokens: number; summaryTokens: number }): SummaryQualityResult {
  return { accepted: input.code === "accepted", ...input };
}

function containsForbidden(value: string): boolean {
  return /(?:BEGIN (?:PRIVATE KEY|OPENSSH)|bearer\s+[A-Za-z0-9._-]+|(?:api[_ -]?key|password|authorization)\s*[:=])/i.test(value)
    || value.includes("<system-reminder>") || value.includes("<untrusted-observation");
}
