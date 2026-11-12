/**
 * INPUT:  optional clock, durable pause store and data-free successful-write observer
 * OUTPUT: ambient consent state, operator-only mutators and lazy absolute-deadline projection
 * POS:    core/perception — sole pause state owner; timer-free hydration/reads never persist or gate on-demand captures
 */
import { notifyPerceptionChange } from "./notify-perception-change.ts";

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

export function createPrivacyPause(deps: {
  now?: () => number;
  store?: PrivacyPauseStore;
  onChange?: () => void;
} = {}): PrivacyPause {
  const now = deps.now ?? Date.now;
  // Restored verbatim: a stored deadline already in the past needs no boot-time special case — settle() reads it as
  // lapsed on the first query, exactly as it would have within one session.
  const restored = deps.store?.load();
  let paused = restored?.paused ?? false;
  let until = restored?.until ?? null;

  // A lapsed deadline self-clears on READ. Samplers and the interested-operator projection deadline use this same
  // timer-free operation; neither becomes a writer. The stored absolute deadline settles identically on every boot.
  function settle(at: number): boolean {
    if (paused && until !== null && at >= until) {
      paused = false;
      until = null;
    }
    return paused;
  }

  // Every change is persisted HERE, in the one module that owns the flag, so no call site can forget to.
  function set(next: PrivacyPauseState): void {
    // Failed persistence must not publish or alter the consent state observed by samplers. Observer failures after
    // this commit are isolated: they cannot change the already confirmed operator result.
    deps.store?.save(next);
    const changed = paused !== next.paused || until !== next.until;
    paused = next.paused;
    until = next.until;
    if (changed) notifyPerceptionChange(deps.onChange);
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
