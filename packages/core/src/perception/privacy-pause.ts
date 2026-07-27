/**
 * INPUT:  an optional injected epoch-ms clock (tests pass a synthetic one; production falls back to Date.now) and an
 *         optional PrivacyPauseStore — the boot snapshot it hydrates from + the sink every change is written to
 * OUTPUT: createPrivacyPause(deps) -> { isPaused, pauseUntilResumed, pauseUntil, resume, state }
 * POS:    core/perception — the ONE Core-owned flag every AMBIENT sampler consults before it observes (the T3a
 *         foreground poll today, the ambient screenshot loop next). On-demand chat captures are deliberately NOT
 *         gated here: those stay explicit in-the-moment consent through the Gate. Pure + OS-neutral; state() is the
 *         serializable shape the perception WS surface / #26 pause badge will read.
 */

/** Serializable pause snapshot. `until` is an epoch-ms auto-resume deadline; null = manual resume (or not paused). */
export interface PrivacyPauseState {
  paused: boolean;
  until: number | null;
}

/**
 * The persistence seam (the core/db privacy_pause_state row in production). A pause is a withdrawal of consent: it
 * must not evaporate on a restart. Hydration goes through the FACTORY, never through a mutator — the mutators have
 * exactly one production caller (`perception.pauseSet`), which is what proves the agent can never un-pause itself
 * (privacy-pause-writer.test.ts sweeps for it).
 */
export interface PrivacyPauseStore {
  load(): PrivacyPauseState | undefined;
  save(state: PrivacyPauseState): void;
}

export interface PrivacyPause {
  /** True while ambient observation is suspended; `at` defaults to the injected clock. */
  isPaused(at?: number): boolean;
  /** Suspend until resume() is called (Recall's manual-resume shape). */
  pauseUntilResumed(): void;
  /** Suspend until an epoch-ms deadline. The CALLER computes it — "until tomorrow" is local midnight, not our concern. */
  pauseUntil(deadlineMs: number): void;
  resume(): void;
  state(at?: number): PrivacyPauseState;
}

export function createPrivacyPause(deps: { now?: () => number; store?: PrivacyPauseStore } = {}): PrivacyPause {
  const now = deps.now ?? Date.now;
  // Restored verbatim: a stored deadline already in the past needs no boot-time special case — settle() reads it as
  // lapsed on the first query, exactly as it would have within one session.
  const restored = deps.store?.load();
  let paused = restored?.paused ?? false;
  let until = restored?.until ?? null;

  // A lapsed deadline self-clears on the next READ rather than on a timer: a paused core must stay silent, and the
  // samplers already poll, so there is nothing to wake up. Keeps this module timer-free and deterministic under a
  // synthetic clock. No write here: the stored deadline settles the same way on every boot.
  function settle(at: number): boolean {
    if (paused && until !== null && at >= until) {
      paused = false;
      until = null;
    }
    return paused;
  }

  // Every change is persisted HERE, in the one module that owns the flag, so no call site can forget to.
  function set(next: PrivacyPauseState): void {
    paused = next.paused;
    until = next.until;
    deps.store?.save(next);
  }

  return {
    isPaused: (at) => settle(at ?? now()),
    pauseUntilResumed: () => set({ paused: true, until: null }),
    // Last call wins: switching shapes replaces the active pause, never stacks (an operator action is authoritative).
    pauseUntil: (deadlineMs) => set({ paused: true, until: deadlineMs }),
    resume: () => set({ paused: false, until: null }),
    state(at) {
      const active = settle(at ?? now());
      return { paused: active, until: active ? until : null };
    },
  };
}
