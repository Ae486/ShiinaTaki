/**
 * INPUT:  a timeline segment (TimelineEntry[]) fetched from the timeline repo
 * OUTPUT: renderTranscript(segment) -> a plain "role: text" transcript string for an LLM prompt
 * POS:    core/memory — shared prompt-building helper for the episodic + flush auto-write paths (no fs, no model)
 */
import type { TimelineEntry } from "@taki/shared";

// One line per turn; the role label orients the summarizer/extractor without leaking ids or timestamps into the prompt.
export function renderTranscript(segment: TimelineEntry[]): string {
  return segment.map((entry) => `${entry.role}: ${entry.content}`).join("\n");
}
