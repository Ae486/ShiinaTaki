import { afterEach, expect, it, vi } from "vitest";
import { HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TRANSITION_BUILD } from "@taki/shared";
import { configurationObservationFixture } from "../../testing/hindsight-configuration-fixture.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { requireHindsightTransitionCapability } from "./hindsight-transition-capability.ts";
import { requireHindsightTemplateCapability } from "./hindsight-template-capability.ts";
import { HindsightCompatibilityWireSchema } from "./hindsight-contracts.ts";

afterEach(() => vi.useRealTimers());

it("keeps old runtimes usable and admits only the exact optional lifecycle build", () => {
  const fixture = configurationObservationFixture();
  try {
    for (const build of [HINDSIGHT_TRANSITION_BUILD, HINDSIGHT_CONFIGURATION_BUILD]) {
      fixture.manifest.source_identity.compatibility_build = build;
      expect(requireHindsightTransitionCapability(fixture.manifest)).toBeDefined();
      expect(() => requireHindsightTemplateCapability(fixture.manifest)).toThrow();
    }
    fixture.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BUILD;
    fixture.manifest.contracts.template_lifecycle = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
    const parsed = HindsightCompatibilityWireSchema.parse(fixture.manifest);
    expect(requireHindsightTemplateCapability(parsed).providerLineage).toBe(parsed.provider.lineage);
    for (const key of ["template_lifecycle", "application_state", "native_results", "transitions"] as const) {
      const bad = structuredClone(parsed); delete bad.contracts[key];
      expect(() => requireHindsightTemplateCapability(bad)).toThrow();
    }
    parsed.source_identity.compatibility_build += "-unknown";
    expect(() => requireHindsightTemplateCapability(parsed)).toThrow();
  } finally { fixture.service.dispose(); }
});

it("invalidates an old preview when the complete manifest gains lifecycle evidence", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
  const harness = await createHealthyTransitionHarness();
  try {
    const old = await harness.request();
    harness.remote.manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BUILD;
    harness.remote.manifest.contracts.template_lifecycle = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
    const refused = harness.owner.submit(old); await harness.owner.stop();
    expect(harness.owner.status(refused.operationId).state).toBe("failed");
    expect(harness.remote.calls.acquire).toBe(0);
    const fresh = harness.owner.submit(await harness.request()); await harness.owner.stop();
    expect(harness.owner.status(fresh.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true } });
  } finally { await harness.close(); }
}, 30_000);
