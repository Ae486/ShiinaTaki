/**
 * INPUT:  a ConfigSource (TAKI_AVATAR_OUTCOME_DEADLINE_MS, env > stored > default)
 * OUTPUT: DEFAULT_AVATAR_OUTCOME_DEADLINE_MS + avatarOutcomeDeadlineMs(source) -> () => number (re-read per call)
 * POS:    core/config — the live-apply reader the avatar outcomes registry consumes; an unparseable value falls back
 *         to the default rather than disabling the wait
 */
import { z } from "zod";
import type { ConfigSource } from "./config-source.ts";

export const AVATAR_OUTCOME_DEADLINE_KEY = "TAKI_AVATAR_OUTCOME_DEADLINE_MS";
export const DEFAULT_AVATAR_OUTCOME_DEADLINE_MS = 1000;

const DeadlineSchema = z.coerce.number().int().min(100).max(10_000);

export function avatarOutcomeDeadlineMs(source: ConfigSource): () => number {
  return () => {
    const parsed = DeadlineSchema.safeParse(source.resolve(AVATAR_OUTCOME_DEADLINE_KEY)?.value);
    return parsed.success ? parsed.data : DEFAULT_AVATAR_OUTCOME_DEADLINE_MS;
  };
}
