/**
 * INPUT:  consecutive observations of the frozen costume hook (switchingId / error / current) and inbound commands.
 * OUTPUT: assertions that every settle is classified into exactly one phase, that a busy or ineligible command is
 *         refused with a named reason instead of the silent return the defect was made of.
 * POS:    unit test for windows/pet/costume-report. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { CostumeAvailability } from "@taki/shared";
import { costumeTransitions, refusalFor, IDLE_OBSERVATION, type CostumeCommandView } from "./costume-report.ts";

const renderable: CostumeAvailability = { renderable: true, missingMotions: 0, missingPacks: [] };
const broken: CostumeAvailability = { renderable: false, missingMotions: 0, missingPacks: ["ksm"] };

const view = (over: Partial<CostumeCommandView> = {}): CostumeCommandView => ({
  switchingId: null,
  costumes: ["taki-default", "taki-summer"],
  availability: { "taki-default": renderable, "taki-summer": renderable },
  ready: true,
  ...over,
});

describe("costumeTransitions", () => {
  it("reports started when the hook takes a switch", () => {
    expect(costumeTransitions(IDLE_OBSERVATION, { switchingId: "taki-summer", error: null, current: "taki-default" })).toEqual([
      { costumeId: "taki-summer", phase: "started" },
    ]);
  });

  it("reports started then succeeded, in that order, across a whole switch", () => {
    const started = { switchingId: "taki-summer", error: null, current: "taki-default" };
    const settled = { switchingId: null, error: null, current: "taki-summer" };

    expect(costumeTransitions(IDLE_OBSERVATION, started)).toEqual([{ costumeId: "taki-summer", phase: "started" }]);
    expect(costumeTransitions(started, settled)).toEqual([{ costumeId: "taki-summer", phase: "succeeded" }]);
  });

  it("reports failed with the cause, stripped of the costume prefix the hook adds", () => {
    const started = { switchingId: "taki-summer", error: null, current: "taki-default" };
    const failed = { switchingId: null, error: "taki-summer: costume switch timed out after 30000ms", current: "taki-default" };

    expect(costumeTransitions(started, failed)).toEqual([
      { costumeId: "taki-summer", phase: "failed", reason: "costume switch timed out after 30000ms" },
    ]);
  });

  it("reports cancelled when the switch is released with neither an error nor a new worn costume", () => {
    const started = { switchingId: "taki-summer", error: null, current: "taki-default" };
    const released = { switchingId: null, error: null, current: "taki-default" };

    expect(costumeTransitions(started, released)).toEqual([{ costumeId: "taki-summer", phase: "cancelled" }]);
  });

  it("stays silent while nothing about the in-flight switch changed", () => {
    const started = { switchingId: "taki-summer", error: null, current: "taki-default" };

    expect(costumeTransitions(started, started)).toEqual([]);
    expect(costumeTransitions(IDLE_OBSERVATION, IDLE_OBSERVATION)).toEqual([]);
  });

  it("settles the outgoing switch before announcing a new one", () => {
    const first = { switchingId: "taki-summer", error: null, current: "taki-default" };
    const second = { switchingId: "taki-default", error: null, current: "taki-summer" };

    expect(costumeTransitions(first, second)).toEqual([
      { costumeId: "taki-summer", phase: "succeeded" },
      { costumeId: "taki-default", phase: "started" },
    ]);
  });
});

describe("refusalFor", () => {
  it("accepts a renderable costume while nothing is in flight", () => {
    expect(refusalFor("taki-summer", view())).toBeNull();
  });

  it("refuses a command that arrives mid-switch instead of returning silently", () => {
    expect(refusalFor("taki-summer", view({ switchingId: "taki-default" }))).toBe("busy");
  });

  it("names the other reasons the switch path would have dropped without a trace", () => {
    expect(refusalFor("taki-summer", view({ ready: false }))).toBe("no-scene");
    expect(refusalFor("taki-winter", view())).toBe("unknown-costume");
    expect(refusalFor("taki-summer", view({ availability: { "taki-summer": broken } }))).toBe("not-renderable");
  });
});
