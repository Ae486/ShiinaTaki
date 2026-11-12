import { afterEach, expect, it, vi } from "vitest";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createConfigSubscriptions } from "../../config/config-subscriptions.ts";
import { createConfigWriter } from "../../config/config-writer.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readHindsightConfigurationContext } from "./hindsight-configuration-context.ts";
import { projectHindsightCompatibilityManifest } from "./hindsight-compatibility-service.ts";
import { createMemoryStatusObserver } from "../operations/memory-status-observer.ts";
import * as native from "../transitions/transition-native-evidence.ts";

afterEach(() => vi.useRealTimers());

it("captures actual pinned Bank identity and rejects config ABA, secret, setup and epoch changes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
  const h = await createHealthyTransitionHarness();
  try {
    // The legacy transition fixture only needs lineage; this production read also
    // validates the complete persisted setup projection before using its revision.
    h.db.prepare("UPDATE hindsight_connection_state SET compatibility_json=:compatibility WHERE singleton=1")
      .run({ compatibility: JSON.stringify(projectHindsightCompatibilityManifest(h.remote.manifest)) });
    const repo = createConfigRepo(h.db); const subscriptions = createConfigSubscriptions();
    const config = createConfigSource({ repo, env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
    let secret = "before";
    const deps = { db: h.db, config, secret: { resolve: () => "unused", marker: () => secret }, configurationRevision: subscriptions.revision, secretRevision: () => 0 };
    const before = readHindsightConfigurationContext(deps, { kind: "global" })!;
    const proof = h.initial.find((row) => row.status.bank_id === before.bankId)!.status.proof!;
    expect(before.providerLineage).toBe(proof.application_snapshot.namespace.provider_lineage);
    expect(before.bankGeneration).toBe(proof.application_snapshot.namespace.bank_generation);
    const writer = createConfigWriter({ env: {}, repo, onChanged: subscriptions.publish });
    expect(writer.set({ key: "TAKI_HINDSIGHT_MODEL_DEFAULT", value: "model-a" }).ok).toBe(true);
    expect(writer.set({ key: "TAKI_HINDSIGHT_MODEL_DEFAULT", value: null }).ok).toBe(true);
    expect(readHindsightConfigurationContext(deps, { kind: "global" })!.contextIdentity).not.toBe(before.contextIdentity);
    const changed = readHindsightConfigurationContext(deps, { kind: "global" })!;
    secret = "rotated";
    expect(readHindsightConfigurationContext(deps, { kind: "global" })!.connectionFingerprint).not.toBe(changed.connectionFingerprint);
    h.db.prepare("UPDATE hindsight_connection_state SET revision=revision+1 WHERE singleton=1").run();
    const setupChanged = readHindsightConfigurationContext(deps, { kind: "global" })!;
    expect(setupChanged.contextIdentity).not.toBe(changed.contextIdentity);
    const admitted = h.owner.submit(await h.request()); await h.owner.stop();
    expect(h.owner.status(admitted.operationId).state).toBe("completed");
    const local = readHindsightConfigurationContext(deps, { kind: "global" })!;
    expect(local.contextIdentity).not.toBe(setupChanged.contextIdentity);
    expect(local.bankGeneration).toBeNull();
    const observer = createMemoryStatusObserver({ db: h.db, runtime: h.runtime });
    try {
      observer.read();
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      try {
        h.db.transaction(() => {
          expect(readHindsightConfigurationContext(deps, { kind: "global" }, observer.read().selection)).toEqual(local);
        });
        expect(verify).not.toHaveBeenCalled();
        expect(readHindsightConfigurationContext(deps, { kind: "global" })).toEqual(local);
        // Configuration comparison reads current control identity; full publication proof remains an admission boundary.
        expect(verify).not.toHaveBeenCalled();
        h.runtime.transitions.verifySelectedAuthority();
        expect(verify).toHaveBeenCalled();
      } finally { verify.mockRestore(); }
    } finally { observer.close(); }
  } finally { await h.close(); }
}, 30_000);
