/**
 * INPUT:  costume-switch event payloads (well-formed and malformed).
 * OUTPUT: assertions that only a non-empty costumeId passes the pet-side gate.
 * POS:    unit test for lib/costume-switch-event. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { COSTUME_SWITCH_EVENT, handleCostumeSwitch, parseCostumeSwitch } from "./costume-switch-event.ts";

describe("costume switch event", () => {
  it("names a pet-scoped event", () => {
    expect(COSTUME_SWITCH_EVENT).toBe("pet:costume-switch");
  });

  it("accepts a well-formed payload", () => {
    expect(parseCostumeSwitch({ costumeId: "taki-summer" })).toEqual({ costumeId: "taki-summer" });
  });

  it("drops garbage instead of forwarding it to the renderer", () => {
    for (const payload of [null, undefined, "taki", 7, {}, { costumeId: "" }, { costumeId: 3 }]) {
      expect(parseCostumeSwitch(payload)).toBeNull();
    }
  });
});

describe("handleCostumeSwitch (the pet-side listener body)", () => {
  it("drives the switch with a valid payload and leaves no warning", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeSwitch({ costumeId: "taki-summer" }, sink);

    expect(sink.apply).toHaveBeenCalledWith("taki-summer");
    expect(sink.warn).not.toHaveBeenCalled();
  });

  it("drops a malformed payload with a breadcrumb instead of switching", () => {
    const sink = { apply: vi.fn(), warn: vi.fn() };

    handleCostumeSwitch({ costume: "oops" }, sink);

    expect(sink.apply).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(1);
  });
});
