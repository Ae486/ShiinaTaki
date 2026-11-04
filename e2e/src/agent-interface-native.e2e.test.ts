import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { startScriptedProvider } from "./fixture/scripted-provider.ts";

describe("agent interface native setup without model inference", () => {
  it("pairs an accepted exec Host and runs real allowlisted hostname with exec=deny", async () => {
    const evidenceRoot = resolve(process.env.TAKI_E2E_EVIDENCE_DIR ?? "../artifacts/delegation-interface-20261104/native-preflight");
    mkdirSync(evidenceRoot, { recursive: true });
    const provider = await startScriptedProvider(() => { throw new Error("native preflight must not invoke a model"); });
    try {
      await withScriptedAgentContextScenario({ name: "native-no-model-preflight", nativeHost: "exec", providerBaseUrl: provider.baseUrl,
        evidenceRoot, maxUpstreamRequests: 1, mainMaxSteps: null }, async (s) => {
        expect(s.nativeHost).toBeDefined();
        expect(s.nativeHost!.accepted.hosts.some((host) => host.hostId !== s.nativeHost!.accepted.coreHostId && host.available)).toBe(true);
        expect(s.nativeHost!.audit()).toEqual(expect.arrayContaining([expect.objectContaining({
          capability: "exec", command: "hostname", decision: "auto-allowed" })]));
        expect(s.requests).toEqual([]);
        expect(s.rows("SELECT effect_id FROM run_effects WHERE kind='model'")).toEqual([]);
        s.checkpoint("accepted-native-host-real-hostname-zero-model-requests");
      });
    } finally { await provider.close(); }
  }, 90_000);
});
