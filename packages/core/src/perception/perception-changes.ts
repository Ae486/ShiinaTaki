/**
 * INPUT:  admitted source changes, opt-in operator interest and the existing absolute pause-state read
 * OUTPUT: process-local invalidations and at most one interested-operator pause projection deadline
 * POS:    core/perception — read projection owner; never captures, calls models, writes pause state or starts sampling
 */
import type { PerceptionPauseState } from "@taki/shared";
import { createPerceptionSubscriptions, type PerceptionSubscriptions } from "./perception-subscriptions.ts";

// Node clamps an overflowing timer delay to 1 ms. Long pauses must instead keep the same absolute deadline and
// wake at bounded segments; this is not a recurring refresh interval or a source of new capture work.
const MAX_DEADLINE_DELAY_MS = 2_147_483_647;

export interface PerceptionChangesDeps {
  /** Read lazily: the Perception layer installs this owner before constructing and starting its producers. */
  pauseState: (at: number) => PerceptionPauseState;
  now?: () => number;
}

export interface PerceptionChanges {
  subscriptions: PerceptionSubscriptions;
  changed(): void;
  pauseChanged(): void;
  dispose(): void;
}

export function createPerceptionChanges(deps: PerceptionChangesDeps): PerceptionChanges {
  return new PerceptionChangesOwner(deps);
}

class PerceptionChangesOwner implements PerceptionChanges {
  readonly subscriptions: PerceptionSubscriptions;
  private readonly pauseState: PerceptionChangesDeps["pauseState"];
  private readonly now: () => number;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadlineEpoch = 0;
  private disposed = false;

  constructor(deps: PerceptionChangesDeps) {
    this.pauseState = deps.pauseState;
    this.now = deps.now ?? Date.now;
    this.subscriptions = createPerceptionSubscriptions(() => this.refreshDeadline());
  }

  changed = (): void => {
    if (this.disposed) return;
    this.revision += 1;
    this.subscriptions.publish({ revision: this.revision });
  };

  pauseChanged = (): void => {
    this.refreshDeadline();
    this.changed();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDeadline();
    this.subscriptions.dispose();
  }

  private clearDeadline(): void {
    this.deadlineEpoch += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private refreshDeadline(): void {
    this.clearDeadline();
    if (this.disposed || this.subscriptions.count() === 0) return;
    const at = this.now();
    const state = this.pauseState(at);
    if (state.paused && state.until !== null) this.schedule(state.until, this.deadlineEpoch, at);
  }

  private schedule(deadline: number, epoch: number, at: number): void {
    const delay = Math.max(1, Math.min(MAX_DEADLINE_DELAY_MS, deadline - at));
    this.timer = setTimeout(() => this.wake(deadline, epoch), delay);
    this.timer.unref();
  }

  private wake(deadline: number, epoch: number): void {
    // A cancelled callback can already be queued. It cannot touch a replacement timer or settle a replacement pause.
    if (this.disposed || epoch !== this.deadlineEpoch || this.subscriptions.count() === 0) return;
    this.timer = undefined;
    const at = this.now();
    const state = this.pauseState(at);
    if (!state.paused) {
      // Another read may have lazily settled expiry first. The pending deadline still owes exactly one invalidation.
      this.deadlineEpoch += 1;
      this.changed();
    } else if (state.until !== deadline) {
      this.refreshDeadline();
    } else {
      // Includes a long deadline and a wall-clock move backwards; retain the absolute source deadline.
      this.schedule(deadline, epoch, at);
    }
  }
}
