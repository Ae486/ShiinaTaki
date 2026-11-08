import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import * as authority from "../legacy-migration/legacy-activation-repo.ts";
import * as native from "../transitions/transition-native-evidence.ts";
import { readMemoryAuthorityStatus } from "./memory-authority-status.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";
import { createMemoryStatusObserver } from "./memory-status-observer.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const h = await createHealthyTransitionHarness();
  try {
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const admitted = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("completed");
    }
    const observer = createMemoryStatusObserver({ db: h.db, runtime: h.runtime });
    const live = h.runtime.operations()!;
    const input = { db: h.db, live: () => live, setup: fakeSetup(), operations: h.owner,
      hindsightBinding: h.runtime.hindsightBindingSnapshot,
      liveConnection: () => ({ state: "ready" as const, fingerprint: live.configFingerprint }) };
    const read = () => {
      const view = observer.readRuntime();
      return readMemoryAuthorityStatus(input, view.selection, view);
    };
    return { ...h, observer, live, input, read, close: async () => { observer.close(); await h.close(); } };
  } catch (error) { await h.close(); throw error; }
}

describe("Hindsight authority status observation", () => {
  it("preserves the full result with separate operator/runtime evidence and settlement outside the read snapshot", async () => {
    const f = await fixture();
    try {
      const expected = readMemoryAuthorityStatus(f.input);
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      authority.readMemoryAuthoritySelection(f.db);
      const independentCount = verify.mock.calls.length; expect(independentCount).toBeGreaterThan(0); verify.mockClear();
      expect(f.read()).toEqual(expected);
      expect(verify).not.toHaveBeenCalled(); verify.mockClear();

      let depth = 0;
      const transaction = f.db.transaction;
      vi.spyOn(f.db, "transaction").mockImplementation((run) => transaction(() => {
        depth++; try { run(); } finally { depth--; }
      }));
      const observe = f.runtime.observeHindsightStatus;
      const projected = vi.spyOn(f.runtime, "observeHindsightStatus").mockImplementation(() => {
        expect(depth).toBeGreaterThan(0); return observe();
      });
      const list = f.owner.list;
      const settled = vi.spyOn(f.owner, "list").mockImplementation((params) => {
        expect(depth).toBe(0); return list(params);
      });
      expect(f.read()).toEqual(expected);
      expect(projected).toHaveBeenCalledTimes(1); expect(settled).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
      verify.mockClear();
      f.live.driftReason(); f.live.assertConnection(); f.live.banks(); f.live.scheduler.status();
      expect(verify).not.toHaveBeenCalled();
      authority.readMemoryAuthoritySelection(f.db);
      expect(verify).toHaveBeenCalledTimes(independentCount);
    } finally { await f.close(); }
  }, 30_000);

  it("refuses current marker drift immediately and withdraws historical damage at the explicit proof boundary", async () => {
    const f = await fixture();
    try {
      expect(f.read().runtime.available).toBe(true);
      f.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
      for (const damage of ["marker", "bytes"] as const) {
        const rollback = new Error("restore fixture");
        expect(() => f.db.transaction(() => {
          if (damage === "bytes") f.db.prepare("UPDATE memory_transition_native_evidence SET body=CAST(json_set(CAST(body AS TEXT),'$.status.proof.proof_hash',:hash) AS BLOB)")
            .run({ hash: "0".repeat(64) });
          else f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:digest").run({ digest: "0".repeat(64) });
          if (damage === "marker") {
            expect(() => f.live.assertConnection()).toThrow("MEMORY_AUTHORITY_MISMATCH");
            expect(f.read().runtime.unavailableReason).toBe("authority_mismatch");
          } else {
            expect(() => f.live.assertConnection()).not.toThrow();
            expect(f.read().runtime.available).toBe(true);
            expect(() => f.runtime.verifySelectedAuthority()).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
            expect(f.read().runtime.unavailableReason).toBe("authority_invalid");
            expect(() => f.live.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
          }
          throw rollback;
        })).toThrow(rollback);
        if (damage === "bytes") f.runtime.recoverHindsightBinding(authority.readMemoryAuthoritySelection(f.db).epochId!);
        const verify = vi.spyOn(native, "verifyTransitionNativeEvidence"); verify.mockClear();
        expect(f.read().runtime.available).toBe(true);
        expect(verify).not.toHaveBeenCalled(); verify.mockRestore();
      }
    } finally { await f.close(); }
  }, 30_000);

  it("preserves runtime failure reasons and does not manufacture evidence when a guard fails", async () => {
    const f = await fixture();
    try {
      f.read();
      for (const [code, reason] of [
        ["MEMORY_OPERATION_CANCELLED", "stopped"],
        ["MEMORY_AUTHORITY_MISMATCH", "authority_mismatch"],
        ["MEMORY_TEMPLATE_IDENTITY_CHANGED", "connection_unavailable"],
      ] as const) {
        vi.spyOn(f.runtime, "observeHindsightStatus").mockImplementationOnce(() => { throw new Error(code); });
        expect(f.read()).toMatchObject({ runtime: { available: false, unavailableReason: reason }, replica: null, pending: null });
        expect(f.observer.readRuntime()).toMatchObject({ runtime: { unavailableReason: null }, boundSelectionIdentity: null });
      }
      await f.runtime.stop();
      expect(f.read()).toMatchObject({ runtime: { available: false, unavailableReason: "stopped" }, replica: null, pending: null });
    } finally { await f.close(); }
  }, 30_000);
});
