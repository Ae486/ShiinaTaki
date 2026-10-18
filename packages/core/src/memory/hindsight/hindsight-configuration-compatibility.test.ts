import { afterEach, expect, it, vi } from "vitest";
import { HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TRANSITION_BUILD } from "@taki/shared";
import { configurationObservationFixture } from "../../testing/hindsight-configuration-fixture.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { requireHindsightTransitionCapability } from "./hindsight-transition-capability.ts";
import { createHindsightCompatibilityService } from "./hindsight-compatibility-service.ts";

afterEach(() => vi.useRealTimers());

it("admits explicit old/new builds while retaining mandatory application, result and transition contracts", () => {
  const f = configurationObservationFixture();
  try {
    for (const build of [HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_CONFIGURATION_BUILD]) {
      f.manifest.source_identity.compatibility_build = build;
      expect(requireHindsightTransitionCapability(f.manifest).providerLineage).toBe(f.manifest.provider.lineage);
      for (const name of ["application_state", "native_results", "transitions"] as const) {
        const bad = structuredClone(f.manifest); delete bad.contracts[name];
        expect(() => requireHindsightTransitionCapability(bad)).toThrow();
      }
    }
    f.manifest.source_identity.compatibility_build = `${HINDSIGHT_CONFIGURATION_BUILD}-unknown`;
    expect(() => requireHindsightTransitionCapability(f.manifest)).toThrow();
  } finally { f.service.dispose(); }
});

it("does not change persisted connection fingerprints when a new optional manifest is admitted", async () => {
  const f = configurationObservationFixture();
  const client = { ...f.client, health: async () => ({ status: "healthy" as const, database: "connected" as const }),
    version: async () => ({ apiVersion: "0.9.0" }) };
  try {
    const compatibility = createHindsightCompatibilityService();
    const newer = await compatibility.validate({ connection: f.current.connection, secretMarker: "same", client });
    f.manifest.source_identity.compatibility_build = HINDSIGHT_TRANSITION_BUILD;
    delete f.manifest.contracts.configuration_observation;
    const older = await compatibility.validate({ connection: f.current.connection, secretMarker: "same", client });
    expect(newer.fingerprint).toBe(older.fingerprint);
    expect(older.compatibility.contracts.configurationObservation).toBeUndefined();
    expect(newer.compatibility.contracts.configurationObservation?.version).toBe("1.0.0");
  } finally { f.service.dispose(); }
});

it("rejects a preview after the whole manifest changes and executes a fresh preview on the new optional build", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
  const h = await createHealthyTransitionHarness();
  try {
    const old = await h.request();
    h.remote.manifest.source_identity.compatibility_build = HINDSIGHT_CONFIGURATION_BUILD;
    h.remote.manifest.contracts.configuration_observation = {
      version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" },
    };
    const refused = h.owner.submit(old); await h.owner.stop();
    expect(h.owner.status(refused.operationId).state).toBe("failed");
    expect(h.remote.calls.acquire).toBe(0);
    const fresh = h.owner.submit(await h.request()); await h.owner.stop();
    expect(h.owner.status(fresh.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true } });
    expect(h.remote.calls.acquire).toBe(2);
  } finally { await h.close(); }
}, 30_000);
