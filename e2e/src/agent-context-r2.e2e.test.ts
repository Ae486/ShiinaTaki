import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realAgentContextEnabled, withAgentContextScenario, withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { createR2ScriptedReply, createR2Timing, exerciseR2 } from "./fixture/agent-context-r2.ts";
import { startScriptedProvider } from "./fixture/scripted-provider.ts";

describe("R2 independent controls and parent completion through production Core", () => {
  it("verifies actual cancel, durable user latch, explicit continuation and publication with controlled HTTP timing", async () => {
    const evidenceRoot = process.env.TAKI_E2E_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), "taki-r2-evidence-"));
    mkdirSync(evidenceRoot, { recursive: true });
    const timing = createR2Timing();
    const provider = await startScriptedProvider(createR2ScriptedReply());
    try {
      await withScriptedAgentContextScenario({ name: "r2-controlled", evidenceRoot, providerBaseUrl: provider.baseUrl,
        maxUpstreamRequests: 16, transport: timing.transport }, (scenario) => exerciseR2(scenario, timing));
      expect(provider.errors).toEqual([]);
    } finally { await provider.close(); }
  }, 260_000);

  it.skipIf(!realAgentContextEnabled)("verifies the same independent controls and explicit publication with real inference", async () => {
    const timing = createR2Timing();
    await withAgentContextScenario({ name: "r2-live", maxUpstreamRequests: 16,
      transport: timing.transport }, (scenario) => exerciseR2(scenario, timing));
  }, 260_000);
});
