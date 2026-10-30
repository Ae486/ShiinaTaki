import { wrapLanguageModel } from "ai";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { generatingModel, failingGenerateModel } from "./mock-language-model.ts";
import { openSourceLiveEvidence, sourceGenerationMiddleware, sourceObserverPorts } from "./source-live-evidence.ts";
import { rmTempDir } from "./rm-temp.ts";

it("fails a completed structural trial that crosses its total deadline with zero upstream calls", async () => {
  const root = mkdtempSync(join(resolve(import.meta.dirname, "../../../../.trellis/tasks/10-21-agent-source-context/research"), "deadline-fixture-"));
  const output = join(root, "evidence");
  const environment = join(root, "synthetic.env");
  writeFileSync(environment, "TAKI_PROVIDER_BASE_URL=http://127.0.0.1:1/v1\nTAKI_PROVIDER_API_KEY=synthetic-unused\nTAKI_PROVIDER_MODEL=synthetic-model\n", "utf8");
  vi.stubEnv("TAKI_E2E_REAL_ENV_FILE", environment); vi.stubEnv("TAKI_E2E_SOURCE_EVIDENCE_DIR", output);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const live = await openSourceLiveEvidence({ maxRequests: 1, paths: [], deadlineMs: 5 });
    await vi.advanceTimersByTimeAsync(6);
    await expect(live.close({ completed: true })).rejects.toThrow("SOURCE_ACCEPTANCE_DEADLINE_EXCEEDED");
    expect(JSON.parse(readFileSync(join(output, "run.json"), "utf8"))).toMatchObject({ completed: true, deadlineExceeded: true });
    expect(JSON.parse(readFileSync(join(output, "requests.json"), "utf8"))).toEqual([]);
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmTempDir(root); }
});

it("loads the existing E2E observation ports without dispatching an upstream request", async () => {
  const ports = await sourceObserverPorts();
  expect(typeof ports.environment).toBe("function");
  const relay = await ports.observe({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "synthetic-unused",
    syntheticCapture: { maxUpstreamRequests: 1, onRequest() { return undefined; } } });
  try { expect(relay.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/); expect(relay.requests).toEqual([]); }
  finally { await relay.close(); }
});

it("preserves one completed generation when synthetic evidence recording fails", async () => {
  const original = generatingModel("synthetic result");
  const failed = vi.fn();
  const model = wrapLanguageModel({ model: original, middleware: sourceGenerationMiddleware({
    record() { throw new Error("synthetic disk failure"); }, failed,
  }) });
  const result = await model.doGenerate({ prompt: [] });
  expect(result.content).toEqual([{ type: "text", text: "synthetic result" }]);
  expect(original.doGenerateCalls).toHaveLength(1); expect(failed).toHaveBeenCalledOnce();
});

it("preserves the exact provider error without observing it or retrying", async () => {
  const error = new Error("provider detail must not enter evidence");
  const original = failingGenerateModel(error); const record = vi.fn(); const failed = vi.fn();
  const model = wrapLanguageModel({ model: original, middleware: sourceGenerationMiddleware({ record, failed }) });
  await expect(model.doGenerate({ prompt: [] })).rejects.toBe(error);
  expect(original.doGenerateCalls).toHaveLength(1); expect(record).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});
