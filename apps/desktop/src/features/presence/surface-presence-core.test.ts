import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceReportParamsSchema, type PresenceReportParams } from "@taki/shared";
import { createPresenceSources } from "../../../../../packages/core/src/presence/presence-sources.ts";
import { createConnectionRegistry } from "../../../../../packages/core/src/server/connection-registry.ts";
import { createSurfacePresence } from "./surface-presence.ts";
import { observeOwnWindow } from "./own-window-visibility.ts";

afterEach(() => vi.useRealTimers());
async function setup() {
  let at = 1000;
  let visible = true;
  let focused = true;
  let pending: Promise<boolean> | undefined;
  const connections = createConnectionRegistry();
  const connection = connections.create();
  connections.authenticate(connection, { deviceId: "desktop", role: "operator", capabilities: [] });
  const sources = createPresenceSources({ connections, now: () => at });
  const reports: PresenceReportParams[] = [];
  const source = createSurfacePresence({ surface: "chat", sourceId: "actual-source", now: () => at, client: {
    presenceReport: async (report) => {
      reports.push(report);
      const result = sources.report(connection, PresenceReportParamsSchema.parse(report));
      expect(result.status).toBe("accepted"); return result;
    }, timelinePresentationReport: async () => ({ status: "accepted", leaseMs: 30000 }), presenceRead: vi.fn(),
  } });
  source.setInputTracking(true); source.start();
  const document = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => focused }) as Document;
  const window = new EventTarget() as Window;
  const visibility = observeOwnWindow({ changed: source.setWindow, checking: source.beginWindowRefresh, document, window, native: {
    isVisible: () => pending ?? Promise.resolve(visible), isMinimized: async () => false, isFocused: async () => focused,
    onFocusChanged: async () => () => undefined, onResized: async () => () => undefined, onCloseRequested: async () => () => undefined,
  } });
  await visibility.refresh();
  const renew = async (count: number) => {
    for (let i = 0; i < count; i++) { at += 15000; await visibility.refresh(); source.renew(); }
  };
  return { source, sources, reports, visibility, window, renew, now: () => at,
    advance: (delta: number) => { at += delta; },
    show: (value: boolean) => { visible = value; }, focus: (value: boolean) => { focused = value; },
    hideDocument: (value: boolean) => { Object.defineProperty(document, "hidden", { value, configurable: true }); },
    pending: (value: Promise<boolean> | undefined) => { pending = value; },
    close: () => { visibility.dispose(); source.dispose(); },
  };
}

describe("actual Desktop producer through Core source authority", () => {
  it("retains old-input proof across actual native renewal withdrawals and emits one genuine return", async () => {
    const f = await setup();
    f.advance(1000); f.source.input("keyboard", true);
    await f.renew(44);
    expect(f.sources.recentReturn()).toBeUndefined();
    expect(f.reports.some((report) => !report.visible && report.inputContinuity === "tracked" && report.lastInput?.ageMs === 660000)).toBe(true);
    expect(f.reports.at(-1)?.lastInput).toMatchObject({ sequence: 1, ageMs: 660000 });
    f.advance(1000); f.source.input("keyboard", true);
    const returned = f.sources.recentReturn()!;
    expect(returned).toMatchObject({ inputAt: f.now(), previousInputAt: 2000, knownInactiveSince: 62000 });
    await f.renew(1);
    expect(f.sources.recentReturn()).toEqual(returned);
    f.close(); expect(f.sources.recentReturn()).toBeUndefined();
  });

  it("captures a genuine trusted event while native visibility refresh is pending", async () => {
    const f = await setup(); f.advance(1000); f.source.input("keyboard", true); await f.renew(44);
    let resolve!: (value: boolean) => void;
    f.pending(new Promise<boolean>((done) => { resolve = done; }));
    const refreshing = f.visibility.refresh();
    expect(f.source.eligible()).toBe(false);
    f.advance(1000); f.source.input("pointer", true);
    expect(f.reports.at(-1)).toMatchObject({ visible: false, inputContinuity: "tracked", lastInput: { sequence: 2, ageMs: 0 } });
    expect(f.sources.recentReturn()).toMatchObject({ inputAt: f.now() });
    resolve(true); await refreshing;
    expect(f.source.eligible()).toBe(true);
    f.close();
  });

  it.each(["hidden", "document-hidden", "blur", "detached", "expired"] as const)("does not bridge an actual %s interval", async (kind) => {
    const f = await setup(); f.advance(1000); f.source.input("keyboard", true); await f.renew(4);
    if (kind === "hidden") { f.show(false); await f.visibility.refresh(); f.show(true); }
    if (kind === "document-hidden") { f.hideDocument(true); await f.visibility.refresh(); f.hideDocument(false); }
    if (kind === "blur") { f.focus(false); f.window.dispatchEvent(new Event("blur")); await f.visibility.refresh(); f.focus(true); }
    if (kind === "detached") { f.source.setInputTracking(false); f.source.setActive(false); f.source.setActive(true); f.source.setInputTracking(true); }
    if (kind === "expired") f.advance(30000);
    await f.renew(40);
    f.advance(1000); f.source.input("keyboard", true);
    expect(f.sources.recentReturn()).toBeUndefined();
    f.close();
  });
});
