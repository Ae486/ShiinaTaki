/**
 * INPUT:  Slice 4 compaction configuration, summary output metadata, and a bounded retiring transcript
 * OUTPUT: quality decisions and retry/cooldown state transitions for the coordinator
 * POS:    core/agents — pure policy helpers; no Timeline/Memory/SQLite writes
 */
import { validateSummary, type SummaryQualityResult } from "./summary-quality.ts";
import { renderSafeTranscript, sanitizeCompactionText } from "./context-reduction.ts";
import type { TimelineEntry } from "@taki/shared";

export function isCharacterCooldownElapsed(input: {
  latestFailure: { operationId: string; updatedAt: string; terminalAt: string | null } | null;
  operationId: string;
  now: Date;
  cooldownMs: number;
}): boolean {
  if (!input.latestFailure || input.latestFailure.operationId === input.operationId || input.cooldownMs === 0) {
    return true;
  }
  const terminalMs = Date.parse(input.latestFailure.terminalAt ?? input.latestFailure.updatedAt);
  return !Number.isFinite(terminalMs) || input.now.getTime() >= terminalMs + input.cooldownMs;
}

export function evaluateSummaryQuality(input: {
  text: string;
  finishReason?: string;
  span: TimelineEntry[];
  previousSummary?: string | null;
  protectedContent?: string[];
  strict: boolean;
  validate?: (input: {
    text: string;
    sourceText: string;
    finishReason?: string;
    protectedContent?: string[];
  }) => SummaryQualityResult;
}): SummaryQualityResult {
  const sourceText = [input.previousSummary ? sanitizeCompactionText(input.previousSummary) : "", renderSafeTranscript(input.span)]
    .filter((part) => part.length > 0)
    .join("\n");
  return input.validate?.({
    text: input.text,
    sourceText,
    finishReason: input.finishReason,
    protectedContent: input.protectedContent,
  }) ?? validateSummary({
    text: input.text,
    sourceText,
    finishReason: input.finishReason,
    protectedContent: input.protectedContent,
    strictShrink: input.strict,
  });
}
