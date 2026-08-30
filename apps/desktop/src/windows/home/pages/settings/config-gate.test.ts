/**
 * INPUT:  onConfigDelta / onConfigReactivation calls across one hide→show cycle of the settings page.
 * OUTPUT: assertions for the batch-7 hidden gate (reactive-read-models.md §d): deltas are skipped while hidden and
 *         recorded, reactivation refetches exactly once, and a reactivation while a load is already running WAITS
 *         instead of stacking a second request.
 * POS:    unit test for settings/config-gate. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { INITIAL_CONFIG_GATE, onConfigDelta, onConfigReactivation } from "./config-gate.ts";

describe("config gate — delta decisions (P1e, batch-7)", () => {
  it("applies deltas locally while the page is shown and records nothing", () => {
    const decision = onConfigDelta(INITIAL_CONFIG_GATE, true);

    expect(decision).toEqual({ state: INITIAL_CONFIG_GATE, apply: true });
  });

  it("skips the local apply while hidden and marks the list stale behind Core truth", () => {
    const decision = onConfigDelta(INITIAL_CONFIG_GATE, false);

    expect(decision.apply).toBe(false);
    expect(decision.state).toEqual({ staleBehind: true });
  });

  it("stays marked (no state churn) when further deltas arrive while hidden", () => {
    const marked = onConfigDelta(INITIAL_CONFIG_GATE, false).state;

    expect(onConfigDelta(marked, false)).toEqual({ state: marked, apply: false });
    expect(onConfigDelta(marked, false).state).toBe(marked);
  });
});

describe("config gate — reactivation decisions (P1e, batch-7)", () => {
  it("refetches ONCE on reactivation when deltas were skipped, clearing the gap", () => {
    const marked = onConfigDelta(INITIAL_CONFIG_GATE, false).state;

    expect(onConfigReactivation(marked, true, false)).toEqual({ state: INITIAL_CONFIG_GATE, refetch: true });
    expect(onConfigReactivation(INITIAL_CONFIG_GATE, true, false).refetch).toBe(false);
  });

  it("never refetches while hidden, even with a recorded gap", () => {
    const marked = onConfigDelta(INITIAL_CONFIG_GATE, false).state;

    const decision = onConfigReactivation(marked, false, false);

    expect(decision).toEqual({ state: marked, refetch: false });
  });

  it("does not stack a second request while a load is already running — it waits, then refetches once on settle", () => {
    const marked = onConfigDelta(INITIAL_CONFIG_GATE, false).state;

    const waiting = onConfigReactivation(marked, true, true);

    expect(waiting.refetch).toBe(false);
    expect(waiting.state).toEqual({ staleBehind: true }); // the gap is kept until the running load settles

    const settled = onConfigReactivation(waiting.state, true, false);

    expect(settled).toEqual({ state: INITIAL_CONFIG_GATE, refetch: true });
  });

  it("clears the gap exactly at the refetch decision, so a later refreshing flip cannot re-trigger", () => {
    const marked = onConfigDelta(INITIAL_CONFIG_GATE, false).state;
    const decided = onConfigReactivation(marked, true, false);

    // The refetch itself makes refreshing flip true, then false — with the gap cleared neither run refetches again.
    expect(onConfigReactivation(decided.state, true, true).refetch).toBe(false);
    expect(onConfigReactivation(decided.state, true, false).refetch).toBe(false);
  });
});
