import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresenceReportParams } from "@taki/shared";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createPresenceService } from "./presence-service.ts";
import { createInitiativeFeedbackRepo } from "./initiative-feedback-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup() {
  let at = 1000;
  let sequence = 1;
  let inputSequence = 0;
  let inputAt: number | null = null;
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const connections = createConnectionRegistry();
  const connection = connections.create();
  connections.authenticate(connection, { deviceId: "device", role: "operator", capabilities: [] });
  const onSourceChanged = vi.fn();
  const service = createPresenceService({ db, connections, now: () => at, onSourceChanged,
    feedback: createInitiativeFeedbackRepo({ db, now: () => at, commitFact: vi.fn() }) });
  const first: PresenceReportParams = { sourceId: "source", sequence, surface: "chat", state: "active",
    visible: true, focused: true, inputContinuity: "tracked", observedAgeMs: 0, lastInput: null };
  expect(service.reportPresence(connection, first).status).toBe("accepted");
  const report = (patch: Partial<PresenceReportParams> = {}) => {
    const result = service.reportPresence(connection, { ...first, sequence: ++sequence,
      lastInput: inputAt === null ? null : { sequence: inputSequence, kind: "keyboard", ageMs: at - inputAt }, ...patch });
    expect(result.status).toBe("accepted"); return result;
  };
  const renew = (count: number, patch: Partial<PresenceReportParams> = {}) => {
    for (let i = 0; i < count; i++) { at += 15000; report(patch); }
  };
  return { service, connections, connection, report, renew, onSourceChanged, now: () => at,
    advance: (value: number) => { at += value; },
    input: () => { inputSequence++; inputAt = at; report(); },
  };
}

describe("genuine source-local presence return", () => {
  it("requires a prior trusted input, explicit old age and ten minutes of continuous inactive coverage", () => {
    const f = setup(); f.advance(1000); f.input();
    f.renew(4);
    expect(f.service.snapshot().state).toBe("unknown");
    expect(f.service.recentReturn()).toBeUndefined();
    f.renew(40);
    expect(f.service.recentReturn()).toBeUndefined();
    f.advance(1); f.input();
    const fact = f.service.recentReturn()!;
    expect(fact).toMatchObject({ inputAt: f.now(), observedAt: f.now(), previousInputAt: 2000, knownInactiveSince: 62000 });
    expect(fact.inputAt - fact.knownInactiveSince).toBeGreaterThanOrEqual(600000);
    expect(f.service.snapshot().state).toBe("present");
    f.advance(1000); f.report();
    expect(f.service.recentReturn()).toEqual(fact);
    f.advance(1000); f.input();
    expect(f.service.recentReturn()).toEqual(fact);
    Object.assign(fact, { inputAt: 1 });
    expect(f.service.recentReturn()?.inputAt).not.toBe(1);
  });

  it.each(["null", "legacy", "suspended", "expired", "same-input-frozen-young-age"] as const)("never manufactures a return from %s", (mode) => {
    const f = setup(); f.advance(1000); f.input();
    if (mode === "expired") { f.advance(30000); f.report(); f.renew(44); }
    else f.renew(44, mode === "null" ? { lastInput: null } : mode === "legacy" ? { inputContinuity: undefined }
      : mode === "suspended" ? { inputContinuity: "suspended", visible: false, focused: false }
        : { lastInput: { sequence: 1, kind: "keyboard", ageMs: 0 } });
    f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeUndefined();
  });

  it("keeps routine exposure withdrawal separate from uninterrupted input capture", () => {
    const f = setup(); f.advance(1000); f.input();
    for (let i = 0; i < 44; i++) {
      f.advance(15000);
      f.report({ visible: false, focused: false, inputContinuity: "tracked" });
      f.report({ visible: true, focused: true, inputContinuity: "tracked" });
    }
    f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeDefined();
    f.report({ visible: false, focused: false, inputContinuity: "suspended" });
    expect(f.service.recentReturn()).toBeUndefined();
    f.report(); f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeUndefined();
  });

  it("expires return freshness and retires it on actual auth/lifecycle replacement", () => {
    const f = setup(); f.advance(1000); f.input(); f.renew(44); f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeDefined();
    f.renew(4);
    expect(f.service.recentReturn()).toBeUndefined();
    f.renew(40); f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeDefined();
    f.connections.authenticate(f.connection, { deviceId: "device", role: "operator", capabilities: [] });
    expect(f.service.recentReturn()).toBeUndefined();
    const replacement = f.connections.create();
    f.connections.authenticate(replacement, { deviceId: "device", role: "operator", capabilities: [] });
    expect(f.service.reportPresence(replacement, { sourceId: "replacement", sequence: 1, observedAgeMs: 0, surface: "chat",
      state: "active", visible: true, focused: true, inputContinuity: "tracked", lastInput: null }).status).toBe("accepted");
    expect(f.service.recentReturn()).toBeUndefined();
  });

  it("does not infer inactivity from a tracked source with no actual input anchor", () => {
    const f = setup(); f.renew(44); f.advance(1); f.input();
    expect(f.service.recentReturn()).toBeUndefined();
    f.service.close(); expect(f.service.recentReturn()).toBeUndefined();
  });

  it("does not piggyback a new return on the rate-limited negative-lifecycle exception", () => {
    const f = setup(); f.advance(1000); f.input(); f.renew(44);
    for (let i = 0; i < 127; i++) f.report();
    f.advance(1);
    expect(f.service.reportPresence(f.connection, { sourceId: "source", sequence: 1000, observedAgeMs: 0, surface: "chat",
      state: "active", visible: false, focused: false, inputContinuity: "tracked",
      lastInput: { sequence: 2, kind: "keyboard", ageMs: 0 } }).status).toBe("accepted");
    expect(f.service.recentReturn()).toBeUndefined();
    expect(f.service.snapshot().state).toBe("unknown");
  });
});
