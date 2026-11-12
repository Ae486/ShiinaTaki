import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresenceReportParams, TimelinePresentationReportParams } from "@taki/shared";
import { createSurfacePresence } from "./surface-presence.ts";

function fixture(surface: "home" | "chat" | "pet" = "chat") {
  const reports: PresenceReportParams[] = [];
  const exposures: TimelinePresentationReportParams[] = [];
  let time = 0;
  const source = createSurfacePresence({ surface, sourceId: surface, now: () => time, client: {
    presenceReport: async (params) => { reports.push(params); return { status: "accepted", leaseMs: 30_000 }; },
    timelinePresentationReport: async (params) => { exposures.push(params); return { status: "accepted", leaseMs: 30_000 }; },
    presenceRead: vi.fn(),
  } });
  source.setInputTracking(true); source.start();
  source.setWindow({ visible: true, focused: true });
  return { source, reports, exposures, time: (next: number) => { time = next; } };
}
afterEach(() => vi.useRealTimers());
describe("surface presence producer", () => {
  it("starts reachability-only and rejects synthetic input, focus and renewal as fresh interaction", () => {
    vi.useFakeTimers();
    const f = fixture();
    expect(f.reports[0]).toMatchObject({ sequence: 1, lastInput: null });
    f.source.input("keyboard", false); f.source.renew();
    expect(f.reports.every((report) => report.lastInput === null)).toBe(true);
    f.time(1_000); f.source.input("keyboard", true);
    expect(f.reports.at(-1)?.lastInput).toEqual({ sequence: 1, kind: "keyboard", ageMs: 0 });
    f.time(16_000); f.source.renew();
    expect(f.reports.at(-1)?.lastInput).toEqual({ sequence: 1, kind: "keyboard", ageMs: 15_000 });
    f.time(61_000); f.source.renew();
    expect(f.reports.at(-1)?.lastInput).toEqual({ sequence: 1, kind: "keyboard", ageMs: 60_000 });
    f.source.dispose();
  });
  it("uses one sequence across presence/exposure and retires only its independent source", () => {
    const home = fixture("home"); const chat = fixture("chat");
    const target = { characterId: "taki", timelineSeq: 12 };
    chat.source.expose(target, true); chat.source.renew();
    expect(chat.exposures.map((report) => report.sequence)).toEqual([3, 5]);
    home.source.dispose();
    expect(chat.source.eligible()).toBe(true);
    chat.source.setActive(false);
    expect(chat.exposures.at(-1)).toMatchObject({ exposed: false });
    chat.source.dispose(); chat.source.setActive(true); chat.source.expose(target, true);
    expect(chat.reports.at(-1)?.state).toBe("retired");
    expect(chat.source.eligible()).toBe(false);
  });
  it("coalesces real input and preserves its age when the delayed report runs", () => {
    vi.useFakeTimers(); const f = fixture();
    f.time(100); f.source.input("pointer", true);
    f.time(400); f.source.input("keyboard", true);
    f.time(1_000); vi.advanceTimersByTime(900);
    expect(f.reports.at(-1)?.lastInput).toEqual({ sequence: 2, kind: "keyboard", ageMs: 600 });
    const count = f.reports.length;
    f.source.dispose(); vi.runAllTimers();
    expect(f.reports).toHaveLength(count + 1);
  });
  it("allows visible unfocused text but neither hidden nor route-inactive sources", () => {
    const f = fixture();
    f.source.setWindow({ visible: true, focused: false }); expect(f.source.eligible()).toBe(true);
    f.source.setWindow({ visible: false, focused: false }); expect(f.source.eligible()).toBe(false);
    f.source.input("pointer", true); expect(f.reports.at(-1)?.lastInput).toBeNull();
    f.source.dispose();
  });
  it("unions independent text regions referencing the same committed row", () => {
    const f = fixture(); const a = {}; const b = {};
    const target = { characterId: "taki", timelineSeq: 12 };
    f.source.expose(target, true, a); f.source.expose(target, true, b);
    expect(f.exposures.map((report) => report.exposed)).toEqual([true]);
    f.source.expose(target, false, a); expect(f.exposures).toHaveLength(1);
    f.source.expose(target, false, b); expect(f.exposures.map((report) => report.exposed)).toEqual([true, false]);
    f.source.dispose();
  });
  it("starts a replacement source without replaying the old input", () => {
    vi.useFakeTimers(); const previous = fixture();
    previous.time(1_000); previous.source.input("pointer", true); previous.source.dispose();
    const next = fixture(); next.source.renew();
    expect(next.reports.every((report) => report.lastInput === null)).toBe(true);
    expect(previous.reports.at(-1)).toMatchObject({ state: "retired", lastInput: null }); next.source.dispose();
  });
});
