/**
 * INPUT:  costume command payloads (home→pet) and costume result payloads (pet→home), well-formed and malformed.
 * OUTPUT: assertions that both directions of the seam only let a fully-shaped payload through, and that a dropped
 *         payload always leaves a breadcrumb instead of a silent no-op.
 * POS:    unit test for lib/costume-switch-event. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COSTUME_CANCEL_EVENT,
  COSTUME_RESULT_EVENT,
  COSTUME_SWITCH_EVENT,
  handleCostumeCancel,
  handleCostumeResult,
  handleCostumeSwitch,
  parseCostumeResult,
  parseCostumeSwitch,
} from "./costume-switch-event.ts";

describe("costume seam event names", () => {
  it("scopes all three legs to the pet namespace", () => {
    expect(COSTUME_SWITCH_EVENT).toBe("pet:costume-switch");
    expect(COSTUME_CANCEL_EVENT).toBe("pet:costume-cancel");
    expect(COSTUME_RESULT_EVENT).toBe("pet:costume-result");
  });
});

describe("parseCostumeSwitch (home→pet commands)", () => {
  it("accepts a well-formed payload", () => {
    expect(parseCostumeSwitch({ costumeId: "taki-summer" })).toEqual({ costumeId: "taki-summer" });
  });

  it("drops garbage instead of forwarding it to the renderer", () => {
    for (const payload of [null, undefined, "taki", 7, {}, { costumeId: "" }, { costumeId: 3 }]) {
      expect(parseCostumeSwitch(payload)).toBeNull();
    }
  });
});

describe("parseCostumeResult (pet→home reports)", () => {
  it("accepts every phase the pet can report", () => {
    for (const phase of ["started", "succeeded", "failed", "cancelled"] as const) {
      expect(parseCostumeResult({ costumeId: "taki-summer", phase })).toEqual({ costumeId: "taki-summer", phase });
    }
  });

  it("keeps a failure reason and ignores an empty one", () => {
    expect(parseCostumeResult({ costumeId: "taki", phase: "failed", reason: "busy" })).toEqual({
      costumeId: "taki",
      phase: "failed",
      reason: "busy",
    });
    expect(parseCostumeResult({ costumeId: "taki", phase: "failed", reason: "" })).toEqual({ costumeId: "taki", phase: "failed" });
  });

  it("drops a payload whose phase is not one the page knows", () => {
    for (const payload of [
      null,
      "succeeded",
      {},
      { costumeId: "taki" },
      { phase: "succeeded" },
      { costumeId: "", phase: "succeeded" },
      { costumeId: "taki", phase: "done" },
      { costumeId: "taki", phase: 1 },
    ]) {
      expect(parseCostumeResult(payload)).toBeNull();
    }
  });
});

describe("listener bodies", () => {
  it("drives a switch with a valid payload and leaves no warning", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeSwitch({ costumeId: "taki-summer" }, sink);

    expect(sink.apply).toHaveBeenCalledWith("taki-summer");
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("drives a cancel with a valid payload", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeCancel({ costumeId: "taki-summer" }, sink);

    expect(sink.apply).toHaveBeenCalledWith("taki-summer");
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("hands the page a parsed result", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeResult({ costumeId: "taki", phase: "failed", reason: "busy" }, sink);

    expect(sink.apply).toHaveBeenCalledWith({ costumeId: "taki", phase: "failed", reason: "busy" });
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("drops a malformed payload with a breadcrumb on every leg", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeSwitch({ costume: "oops" }, sink);
    handleCostumeCancel({ costume: "oops" }, sink);
    handleCostumeResult({ costumeId: "taki", phase: "oops" }, sink);

    expect(sink.apply).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(3);
  });
});
