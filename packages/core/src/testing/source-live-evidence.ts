/**
 * INPUT: explicitly enabled synthetic Source trial, provider settings and owned evidence directory
 * OUTPUT: physically capped observed model, incremental synthetic evidence and source freeze hashes
 * POS: core/testing — paid acceptance helper only; never used by production logging
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import { createModels } from "../config/provider-factory.ts";
import { loadProviderConfig } from "../config/provider-config.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
type SourceObserver = (input: { baseUrl: string; apiKey: string;
  syntheticCapture: { maxUpstreamRequests: number; onRequest(request: { requestNumber: number; body: string }): undefined };
}) => Promise<{ baseUrl: string; requests: readonly unknown[]; close(): Promise<void> }>;

// The E2E helpers have their own TypeScript root. Load their existing runtime exports without importing that tree into Core's emit graph.
export async function sourceObserverPorts() {
  const observe: SourceObserver = (await import(pathToFileURL(join(ROOT, "e2e/src/fixture/real-provider-observer.ts")).href)).observeRealProvider;
  const environment: () => Record<string, string> | null = (await import(pathToFileURL(join(ROOT, "e2e/src/fixture/paths.ts")).href)).realProviderEnv;
  return { observe, environment };
}

interface SourceLiveEvidence {
  model: LanguageModel; requestedModel: string; provider: string;
  save(name: string, value: unknown): void;
  close(metadata: Record<string, unknown>): Promise<void>;
}

export async function openSourceLiveEvidence(input: { maxRequests: number; paths: string[]; deadlineMs?: number;
  inspectRequest?: (request: { requestNumber: number; body: string }) => void;
}): Promise<SourceLiveEvidence> {
  const ports = await sourceObserverPorts();
  const environment = ports.environment();
  if (!environment) throw new Error("SOURCE_PROVIDER_CONFIGURATION_MISSING");
  const config = loadProviderConfig(environment);
  const output = resolve(process.env.TAKI_E2E_SOURCE_EVIDENCE_DIR ?? "");
  const allowed = resolve(ROOT, ".trellis/tasks/10-21-agent-source-context/research");
  if (!output.startsWith(allowed + sep)) throw new Error("SOURCE_EVIDENCE_PATH_REQUIRED");
  if (existsSync(output) && readdirSync(output).length) throw new Error("SOURCE_EVIDENCE_DIRECTORY_NOT_EMPTY");
  mkdirSync(output, { recursive: true });
  const save = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", "utf8");
  const paths = [...new Set(["pnpm-lock.yaml", "packages/core/src/testing/source-live-evidence.ts",
    "e2e/src/fixture/real-provider-observer.ts", "e2e/src/fixture/paths.ts", ...input.paths])];
  const hashes = () => Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex")]));
  const before = hashes(); save("source-hashes-before.json", before);
  const relay = await ports.observe({ baseUrl: config.baseUrl, apiKey: config.apiKey, syntheticCapture: {
    maxUpstreamRequests: input.maxRequests,
    onRequest(request) {
      writeFileSync(join(output, `request-${request.requestNumber}.json`), request.body, "utf8");
      input.inspectRequest?.(request);
    },
  } });
  const supplied = createModels({ provider: { ...config, baseUrl: relay.baseUrl, apiKey: "synthetic-observer-only" }, vision: null, includeUsage: true }).model;
  if (typeof supplied === "string" || supplied.specificationVersion !== "v4") {
    await relay.close(); throw new Error("SOURCE_ACCEPTANCE_MODEL_VERSION_UNEXPECTED");
  }
  const generations: unknown[] = []; const observationFailures: string[] = [];
  const model = wrapLanguageModel({ model: supplied, middleware: sourceGenerationMiddleware({
    record(value) { generations.push(value); save("generations.json", generations); },
    failed() { observationFailures.push("SOURCE_GENERATION_OBSERVATION_FAILED"); },
  }) });
  let deadlineExceeded = false;
  const deadlineMs = input.deadlineMs ?? 540_000;
  const deadlineAt = Date.now() + deadlineMs;
  const timer = setTimeout(() => {
    deadlineExceeded = true;
    void relay.close().catch(() => { observationFailures.push("SOURCE_DEADLINE_CLOSE_FAILED"); });
  }, deadlineMs);
  return { model, requestedModel: config.model, provider: "openai-compatible", save,
    async close(metadata: Record<string, unknown>) {
      clearTimeout(timer);
      await relay.close();
      deadlineExceeded ||= Date.now() >= deadlineAt;
      const after = hashes();
      save("requests.json", relay.requests); save("source-hashes-after.json", after);
      save("run.json", { ...metadata, requestedModel: config.model, physicalRequestsLimit: input.maxRequests,
        sourceUnchanged: JSON.stringify(before) === JSON.stringify(after), deadlineExceeded, observationFailures });
      if (deadlineExceeded) throw new Error("SOURCE_ACCEPTANCE_DEADLINE_EXCEEDED");
      if (observationFailures.length) throw new Error("SOURCE_ACCEPTANCE_OBSERVATION_INCOMPLETE");
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("SOURCE_ACCEPTANCE_SOURCE_CHANGED");
    },
  };
}

/** Observe already completed Utility generations; evidence failure never turns success into a provider retry. */
export function sourceGenerationMiddleware(sink: { record(value: unknown): void; failed(): void }): LanguageModelMiddleware {
  return { specificationVersion: "v4", async wrapGenerate({ doGenerate }) {
    const result = await doGenerate();
    try {
      sink.record({ modelId: result.response?.modelId ?? null, finishReason: result.finishReason.unified,
        text: result.content.flatMap((part) => part.type === "text" ? [part.text] : []).join(""),
        inputTokens: result.usage.inputTokens.total ?? null, outputTokens: result.usage.outputTokens.total ?? null });
    } catch { sink.failed(); }
    return result;
  } };
}
