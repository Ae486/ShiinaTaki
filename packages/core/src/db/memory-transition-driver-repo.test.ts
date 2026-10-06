import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightTransitionAcquireSchema } from "@taki/shared";
import { openDatabase } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { seedTransition, startTransition, TRANSITION_AT } from "./memory-transition-fixtures.ts";
import { initializeTransitionDriverBanks, prepareTransitionNativeCommand, markTransitionNativeDispatched } from "./memory-transition-driver-repo.ts";
import { sealTransitionUndispatched, readTransitionUndispatched } from "./memory-transition-undispatched.ts";
import { readTransitionNativeRelease } from "./memory-transition-native-outcome.ts";
import { signHindsightTransitionAcquire } from "../memory/hindsight/hindsight-transition-proof.ts";
import { changeTransitionAdmission, renewTransitionLease, requireTransitionLease } from "./memory-transition-repo.ts";
import { abortMemoryTransition } from "./memory-transition-abort.ts";

describe("healthy native dispatch evidence", () => {
  it("positively releases a complete never-dispatched inventory without inventing any native outcome", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const intent = seedTransition(db); let lease = startTransition(db, intent);
      const work = () => ({ lease, now: TRANSITION_AT });
      const banks = initializeTransitionDriverBanks(db, work());
      expect(banks.length).toBe(intent.request.expected.banks.length);
      for (const bank of banks) sealTransitionUndispatched(db, { ...work(), bankId: bank.nativeBankId });
      lease = changeTransitionAdmission(db, { ...work(), action: "close" });
      const release = readTransitionNativeRelease(db, work());
      expect(release.banks.every((bank) => bank.fenceId === null && bank.outcomeReceiptId === null && bank.dispatch === "never-dispatched")).toBe(true);
      expect(db.prepare("SELECT count(*) n FROM memory_transition_native_outcomes").get()?.n).toBe(0);
      expect(abortMemoryTransition(db, { ...work(), failed: true }).result).toMatchObject({ outcome: "failed", authorityCommitted: false });
      expect(readTransitionUndispatched(db, intent.transitionId, banks[0]!.nativeBankId)).toBeDefined();
    } finally { db.close(); }
  });
  it("reserves dispatch before I/O and refuses non-dispatch release even when no acknowledgement exists", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const intent = seedTransition(db); const lease = startTransition(db, intent); const work = { lease, now: TRANSITION_AT };
      const bank = initializeTransitionDriverBanks(db, work)[0]!;
      const request = signHindsightTransitionAcquire(bank.nativeBankId, HindsightTransitionAcquireSchema.parse({
        transition_id: intent.transitionId, attempt_id: randomUUID(), provider_lineage: randomUUID(), bank_generation: randomUUID(),
        direction: "return-local", request_hash: "0".repeat(64) }));
      const command = prepareTransitionNativeCommand(db, { ...work, command: { kind: "acquire", bankId: bank.nativeBankId, slot: "original", request } });
      markTransitionNativeDispatched(db, { ...work, command });
      expect(() => sealTransitionUndispatched(db, { ...work, bankId: bank.nativeBankId })).toThrow("OUTCOME_UNKNOWN");
      expect(() => readTransitionNativeRelease(db, work)).toThrow("OUTCOME_UNKNOWN");
      expect(db.prepare("SELECT count(*) n FROM memory_transition_native_dispatches").get()?.n).toBe(1);
      markTransitionNativeDispatched(db, { ...work, command });
      expect(db.prepare("SELECT count(*) n FROM memory_transition_native_dispatches").get()?.n).toBe(1);
    } finally { db.close(); }
  });
  it("renews only the same live executor without changing the phase CAS revision", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const lease = startTransition(db, seedTransition(db)); const now = new Date(Date.parse(TRANSITION_AT) + 20_000).toISOString();
      renewTransitionLease(db, { lease, now });
      expect(requireTransitionLease(db, { lease, now }).revision).toBe(lease.revision);
      expect(() => renewTransitionLease(db, { lease: { ...lease, attemptId: randomUUID() }, now })).toThrow("LEASE_LOST");
    } finally { db.close(); }
  });
});
