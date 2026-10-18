/**
 * INPUT:  synthetic single-Bank runtime and programmable observation transport
 * OUTPUT: actual Core service/client with mutable context, monotonic time and retained request traces
 * POS:    core/testing — deterministic zero-model fixture; never installed Native or original-data evidence
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_CONFIGURATION_BUILD, type HindsightConfigurationObservation, type HindsightConfigurationScope } from "@taki/shared";
import { createHindsightClient, type HindsightTransportResponse } from "../memory/hindsight/hindsight-client.ts";
import type { HindsightConfigurationCapture } from "../memory/hindsight/hindsight-configuration-context.ts";
import { createHindsightConfigurationService } from "../memory/hindsight/hindsight-configuration-service.ts";
import { applicationTestCompatibility } from "./hindsight-application-runtime-fixtures.ts";

export function configurationObservationFixture() {
  const manifest = applicationTestCompatibility();
  manifest.source_identity = { upstream_commit: "4b2041eb3de5c4235f4a3dd5619fc47cce782e29", compatibility_build: HINDSIGHT_CONFIGURATION_BUILD };
  const versioned = { version: "1.0.0", support: { state: "supported" as const, reason: "all_contracts_available" as const } };
  manifest.contracts.configuration_observation = versioned;
  manifest.contracts.transitions = versioned;
  manifest.contracts.transition_source_evidence = versioned;
  const current: HindsightConfigurationCapture = {
    contextIdentity: "context-1", connectionFingerprint: "fingerprint-1", bankId: "bank",
    providerLineage: manifest.provider.lineage, bankGeneration: randomUUID(),
    connection: { enabled: true, endpoint: "http://127.0.0.1:18392", deploymentMode: "existing-instance",
      apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 1000, setupTimeoutMs: 5000,
      desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: "mock", defaultModel: "model", retainModel: null,
        reflectModel: "different", consolidationModel: null, embeddingProvider: "local", embeddingModel: null,
        rerankerProvider: null, rerankerModel: null } },
  };
  const state = { time: 0, available: true, session: randomUUID(), mode: "success", calls: [] as string[],
    reply: null as null | ((value: HindsightConfigurationObservation) => Promise<HindsightTransportResponse>),
    rewrite: null as null | ((value: HindsightConfigurationObservation) => unknown) };
  const read = (scope: HindsightConfigurationScope) => state.available ? structuredClone({ ...current,
    bankId: scope.kind === "global" ? current.bankId : `bank-${scope.characterId}` }) : null;
  const client = createHindsightClient({ endpoint: current.connection.endpoint, resolveApiKey: () => "fixture-secret", transport: async (input, init, limit) => {
    const url = new URL(input); state.calls.push(url.pathname);
    if ((init?.headers as Record<string, string>).authorization !== "Bearer fixture-secret") throw new Error("missing fixture auth");
    if (url.pathname.endsWith("/version")) return { status: 200, body: JSON.stringify(manifest) };
    if (!url.pathname.endsWith("/configuration-observation") || limit !== 16 * 1024) throw new Error("unexpected endpoint");
    if (state.mode === "deny") return { status: 403, body: JSON.stringify({ error: "taki_configuration_observation_refused", reason: "not_authorized" }) };
    if (state.mode === "fail") throw new Error("private-fixture-error");
    const observation: HindsightConfigurationObservation = { version: "1.0.0", nonce: url.searchParams.get("nonce") ?? "",
      observedAt: "2026-10-07T00:00:00Z", runtimeSessionId: state.session, source: {
        upstreamCommit: manifest.source_identity.upstream_commit, compatibilityBuild: manifest.source_identity.compatibility_build },
      target: { providerLineage: current.providerLineage ?? manifest.provider.lineage ?? "", bankId: decodeURIComponent(url.pathname.split("/").at(-2) ?? ""), bankGeneration: current.bankGeneration ?? randomUUID() },
      executionCoverage: "api_runtime_only", workerConfiguration: "unknown", embedding: { kind: "unknown", reason: "not_covered" },
      reranker: { kind: "unknown", reason: "not_covered" }, profiles: { default: { kind: "single", provider: "mock", configuredModel: "model" },
        retain: { kind: "single", provider: "mock", configuredModel: "model" }, reflect: { kind: "single", provider: "mock", configuredModel: "model" },
        consolidation: { kind: "disabled" } } };
    return state.reply ? state.reply(observation) : { status: 200, body: JSON.stringify(state.rewrite ? state.rewrite(observation) : observation) };
  } });
  const deps = { read, client: () => client, monotonic: () => state.time, now: () => "2026-10-07T00:00:01Z" };
  return { current, state, manifest, client, deps, service: createHindsightConfigurationService(deps) };
}
