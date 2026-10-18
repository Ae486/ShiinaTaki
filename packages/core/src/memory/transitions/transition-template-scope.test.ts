import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createTemplateTransitionSource } from "../../testing/memory-transition-template-fixtures.ts";
import { readHealthyTransitionIdentity } from "./transition-current-identity.ts";
import { readTransitionTemplateState, assertTransitionTemplatesCurrent } from "./transition-template-state.ts";

it("binds selected ownership to exact incarnation and keeps newly resolved scopes unmanaged", async () => {
  const { fixture } = await createTemplateTransitionSource({ removed: true });
  try {
    const lineage = fixture.native.manifest.provider.lineage;
    if (!lineage) throw new Error("scope fixture requires verified Native lineage");
    const identity = readHealthyTransitionIdentity(fixture.db, { kind: "transition.return-local", templateBackup: true,
      fingerprint: fixture.live.configFingerprint, providerLineage: lineage });
    const old = readTransitionTemplateState(fixture.db, identity);
    expect(old.body.banks.every((bank) => bank.selected !== null)).toBe(true);
    const changed = structuredClone(identity); const bank = changed.banks.find((entry) => entry.scope.kind === "character")!;
    bank.nativeGeneration = randomUUID();
    const replacement = readTransitionTemplateState(fixture.db, changed);
    expect(replacement.body.banks.find((entry) => entry.scope === "character")?.selected).toBeNull();
    expect(() => assertTransitionTemplatesCurrent(fixture.db, changed)).toThrow("MEMORY_TRANSITION_STALE");
    expect(readTransitionTemplateState(fixture.db, identity)).toEqual(old);

    const fresh = structuredClone(identity); const target = old.body.banks.find((entry) => entry.scope === "character")!.target;
    const scope = fresh.banks.find((entry) => entry.scope.kind === "character")!;
    scope.nativeBankId = null; scope.nativeGeneration = null; scope.targetBankId = target.bank_id;
    // An allegedly new scope cannot adopt the existing incarnation's selected history.
    expect(() => readTransitionTemplateState(fixture.db, fresh, [target])).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    const newTarget = { ...target, bank_generation: randomUUID() };
    const state = readTransitionTemplateState(fixture.db, fresh, [newTarget]);
    expect(state.body.banks.find((entry) => entry.scope === "character")?.selected).toBeNull();
    expect(state.body.banks.find((entry) => entry.scope === "character")?.receiptInventory.count).toBe(0);
    expect(() => readTransitionTemplateState(fixture.db, fresh, [{ ...newTarget, provider_lineage: randomUUID() }])).toThrow();
    const wrongScope = structuredClone(identity); wrongScope.banks.find((entry) => entry.scope.kind === "character")!.scope.characterId = "another-character";
    expect(() => assertTransitionTemplatesCurrent(fixture.db, wrongScope)).toThrow("MEMORY_TRANSITION_STALE");
  } finally { await fixture.close(); }
}, 30_000);
