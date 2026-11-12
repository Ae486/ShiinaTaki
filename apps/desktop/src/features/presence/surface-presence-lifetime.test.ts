import { describe, expect, it, vi } from "vitest";
import type { PresenceReportParams } from "@taki/shared";
import { retainSurfacePresence } from "./surface-presence-lifetime.ts";

function fixture() {
  const reports: PresenceReportParams[] = [];
  let close!: () => void;
  const client = { presenceReport: async (report: PresenceReportParams) => {
    reports.push(report); return { status: "accepted" as const, leaseMs: 30_000 };
  }, timelinePresentationReport: vi.fn(), presenceRead: vi.fn(), onClose: (callback: () => void) => { close = callback; } };
  return { client, reports, close: () => close() };
}

describe("socket-bound presence render lifetime", () => {
  it("survives StrictMode setup/cleanup/setup and a later remount without rotating or retiring its source", () => {
    const f = fixture(); const first = retainSurfacePresence(f.client, "chat");
    first.source.start(); first.source.setWindow({ visible: true, focused: false });
    first.release();
    expect(f.reports.at(-1)).toMatchObject({ state: "active", visible: false });
    const second = retainSurfacePresence(f.client, "chat");
    second.source.setActive(true); second.source.start();
    expect(second.source).toBe(first.source);
    second.release(); const later = retainSurfacePresence(f.client, "chat");
    later.source.setActive(true);
    expect(new Set(f.reports.map((report) => report.sourceId)).size).toBe(1);
    expect(f.reports.some((report) => report.state === "retired")).toBe(false);
    f.close(); expect(f.reports.at(-1)?.state).toBe("retired");
    expect(later.source.eligible()).toBe(false); later.release();
  });
  it("does not suspend another attached render owner and never revives a closed connection", () => {
    const f = fixture(); const a = retainSurfacePresence(f.client, "pet"); const b = retainSurfacePresence(f.client, "pet");
    a.source.start(); a.source.setWindow({ visible: true, focused: false });
    a.release(); expect(b.source.eligible()).toBe(true);
    f.close(); const c = retainSurfacePresence(f.client, "pet"); c.source.setActive(true); c.source.start();
    expect(c.source.eligible()).toBe(false); b.release(); c.release();
  });
});
