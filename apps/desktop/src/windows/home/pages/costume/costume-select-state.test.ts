/**
 * INPUT:  the costume page's own actions (a click, an undeliverable command, the operator's Cancel, the deadline) and
 *         the pet's result events.
 * OUTPUT: assertions for the two acceptance criteria the home migration regressed — manual check #74 (the highlight
 *         must stay on the pre-switch costume until the pet confirms) and #75 (exactly one pending row, Cancel, and a
 *         page that accepts the next click without being reopened).
 * POS:    unit test for windows/home/pages/costume/costume-select-state. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { CostumeResultPayload } from "@/lib/costume-switch-event.js";
import { IDLE, reduceCostumeSelect, type CostumeSelectState } from "./costume-select-state.ts";

const worn: CostumeSelectState = { pending: null, selected: "taki-default", error: null };

const click = (state: CostumeSelectState, costumeId: string): CostumeSelectState =>
  reduceCostumeSelect(state, { kind: "request", costumeId });

const result = (state: CostumeSelectState, payload: CostumeResultPayload): CostumeSelectState =>
  reduceCostumeSelect(state, { kind: "result", result: payload });

describe("a click", () => {
  it("marks the row pending WITHOUT moving the selection (#74)", () => {
    const state = click(worn, "taki-summer");

    expect(state.pending).toBe("taki-summer");
    expect(state.selected).toBe("taki-default");
  });

  it("clears the previous failure so the page does not carry a stale reason", () => {
    const state = click({ pending: null, selected: "taki-default", error: "taki-summer：超时" }, "taki-summer");

    expect(state.error).toBeNull();
  });

  it("keeps the in-flight row pending when another row is clicked, and says why (#75)", () => {
    const pending = click(worn, "taki-summer");

    const second = click(pending, "taki-winter");

    expect(second.pending).toBe("taki-summer");
    expect(second.error).toContain("taki-summer");
  });
});

describe("the pet's result", () => {
  it("moves the selection only on succeeded, and clears the pending row", () => {
    const started = result(click(worn, "taki-summer"), { costumeId: "taki-summer", phase: "started" });
    expect(started).toEqual({ pending: "taki-summer", selected: "taki-default", error: null });

    const done = result(started, { costumeId: "taki-summer", phase: "succeeded" });
    expect(done).toEqual({ pending: null, selected: "taki-summer", error: null });
  });

  it("leaves the selection on the pre-switch costume when the switch fails (#74)", () => {
    const failed = result(click(worn, "taki-summer"), {
      costumeId: "taki-summer",
      phase: "failed",
      reason: "costume switch timed out after 30000ms",
    });

    expect(failed.selected).toBe("taki-default");
    expect(failed.pending).toBeNull();
    expect(failed.error).toContain("taki-summer");
    expect(failed.error).toContain("timed out");
  });

  it("translates the pet's refusal words instead of showing them raw", () => {
    const busy = result(click(worn, "taki-summer"), { costumeId: "taki-summer", phase: "failed", reason: "busy" });

    expect(busy.error).toContain("taki-summer");
    expect(busy.error).not.toContain("busy");
  });

  it("accepts the very next click after a failure — the wedge is gone (#75)", () => {
    const failed = result(click(worn, "taki-summer"), { costumeId: "taki-summer", phase: "failed", reason: "busy" });

    const retry = click(failed, "taki-summer");
    expect(retry.pending).toBe("taki-summer");
    expect(retry.error).toBeNull();

    // Re-clicking the SAME row passes even under the wedge (the busy guard lets the pending id through), so the pin
    // that actually proves the release is a DIFFERENT row: it is refused while anything is still pending.
    const elsewhere = click(failed, "taki-winter");
    expect(elsewhere.pending).toBe("taki-winter");
    expect(elsewhere.error).toBeNull();
  });

  it("resets cleanly on a cancelled phase", () => {
    const cancelled = result(click(worn, "taki-summer"), { costumeId: "taki-summer", phase: "cancelled" });

    expect(cancelled).toEqual({ pending: null, selected: "taki-default", error: null });
  });

  it("ignores a result for a costume this page is not waiting on", () => {
    const pending = click(worn, "taki-summer");

    expect(result(pending, { costumeId: "taki-winter", phase: "failed", reason: "busy" })).toEqual(pending);
    expect(result(pending, { costumeId: "taki-winter", phase: "cancelled" })).toEqual(pending);
  });

  it("still follows a succeeded switch the page did not command (the pet is wearing it)", () => {
    expect(result(worn, { costumeId: "taki-winter", phase: "succeeded" }).selected).toBe("taki-winter");
  });

  it("clears a stale deadline message when the slow switch lands after all", () => {
    // The exact sequence D61 makes likely: the 45s deadline fires, THEN the pet finishes. Leaving the error would put
    // "宠物窗口没有响应" on screen underneath a highlight that just moved to the new costume — the UI contradicting
    // itself, which is the whole class of defect this batch exists to remove.
    const timedOut = reduceCostumeSelect(click(worn, "taki-summer"), { kind: "timeout", costumeId: "taki-summer" });
    expect(timedOut.error).not.toBeNull();

    const late = result(timedOut, { costumeId: "taki-summer", phase: "succeeded" });

    expect(late).toEqual({ pending: null, selected: "taki-summer", error: null });
  });
});

describe("the page's own escapes", () => {
  it("releases the row on Cancel without moving the selection (#75)", () => {
    const cancelled = reduceCostumeSelect(click(worn, "taki-summer"), { kind: "cancel" });

    expect(cancelled).toEqual({ pending: null, selected: "taki-default", error: null });
  });

  it("un-wedges on the deadline even if the pet never answers (#74/#75)", () => {
    const timedOut = reduceCostumeSelect(click(worn, "taki-summer"), { kind: "timeout", costumeId: "taki-summer" });

    expect(timedOut.pending).toBeNull();
    expect(timedOut.selected).toBe("taki-default");
    expect(timedOut.error).toContain("taki-summer");
  });

  it("ignores a deadline that belongs to an older click", () => {
    const pending = click(worn, "taki-summer");

    expect(reduceCostumeSelect(pending, { kind: "timeout", costumeId: "taki-winter" })).toEqual(pending);
  });

  it("reports an undeliverable command instead of leaving a dead click", () => {
    const dead = reduceCostumeSelect(click(IDLE, "taki-summer"), { kind: "undeliverable", costumeId: "taki-summer", reason: "no window" });

    expect(dead.pending).toBeNull();
    expect(dead.error).toContain("no window");
  });
});
