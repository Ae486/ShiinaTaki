/**
 * INPUT:  an already-SCRUBBED VLM description of one ambient frame + the epoch-ms it was observed
 * OUTPUT: createScreenContext({ staleAfterMs }) -> { push, latest }; renderScreenContext(context, now) -> a fenced
 *         prompt section, or "" when there is nothing current to report
 * POS:    core/perception — the read side of ambient screen sampling: a bounded (single-observation) in-memory state,
 *         the twin of activity-state/render-activity. What lands here is ALREADY scrubbed (scrub-then-fence, prd
 *         ruling 5); the A1 fence is applied HERE, at prompt assembly, exactly like render-activity. Never persisted
 *         (D43 precedent), so no ambient description ever reaches the un-fenced episodic path.
 */
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { formatRelativeAge } from "../time/time-context.ts";

const SOURCE = "ambient-screen-sampler";

export interface ScreenObservation {
  description: string;
  at: number;
}

export interface ScreenContext {
  /** Replace the current observation (only the latest screen matters; older frames are already dropped). */
  push(description: string, at: number): void;
  /** Retire cached context immediately on consent/source invalidation. */
  clear(): void;
  /** The current observation, or undefined once it is older than staleAfterMs (a stopped/paused sampler bleeds out). */
  latest(now: number): ScreenObservation | undefined;
}

export function createScreenContext(config: { staleAfterMs: number }): ScreenContext {
  let observation: ScreenObservation | undefined;
  return {
    push(description, at) {
      observation = { description, at };
    },
    clear() { observation = undefined; },
    // Staleness is applied on READ, not on a timer: a paused core must stay silent, and there is nothing to wake up.
    // Without it a pause (or a denied grant) would leave the last screen in every future prompt, indefinitely.
    latest(now) {
      if (observation === undefined) return undefined;
      return now >= observation.at && now - observation.at <= config.staleAfterMs ? { ...observation } : undefined;
    },
  };
}

/** Build the fenced screen section, or "" when nothing current is observed (contributes nothing to the join). */
export function renderScreenContext(context: ScreenContext, now: number): string {
  const observation = context.latest(now);
  if (observation === undefined) return "";
  // The age is computed by CODE, never left to the model (time spec); time-context is its single home.
  const age = formatRelativeAge(new Date(observation.at).toISOString(), now);
  return fenceUntrusted({ source: SOURCE, content: `Screen (${age}): ${observation.description}` });
}
