/**
 * INPUT:  live target capture, bounded authenticated Native reads and a monotonic clock
 * OUTPUT: operator observation/status with coalescing, identity guards and a 60-second Core-owned lifetime
 * POS:    core/memory/hindsight — in-process evidence only; no durable operation, provider call or authority mutation
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_CONFIGURATION_VERSION, HINDSIGHT_CONFIGURATION_TTL_MS, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD,
  HindsightConfigurationObservationSchema, HindsightConfigurationStatusSchema, type HindsightConfigurationParams,
  type HindsightConfigurationObservation, type HindsightConfigurationScope, type HindsightConfigurationStatus } from "@taki/shared";
import type { HindsightClient } from "./hindsight-client.ts";
import type { HindsightCompatibilityWire } from "./hindsight-contracts.ts";
import type { HindsightConfigurationCapture } from "./hindsight-configuration-context.ts";
import { compareHindsightConfiguration, safeHindsightDesiredConfiguration } from "./hindsight-configuration-comparison.ts";
import { projectHindsightCompatibilityManifest } from "./hindsight-compatibility-service.ts";
import { HindsightError } from "./hindsight-errors.ts";

export interface HindsightConfigurationService {
  observe(params: HindsightConfigurationParams): Promise<HindsightConfigurationStatus>;
  status(params: HindsightConfigurationParams): HindsightConfigurationStatus;
  dispose(): void;
}
export interface HindsightConfigurationServiceDeps {
  read(scope: HindsightConfigurationScope): HindsightConfigurationCapture | null;
  client(capture: HindsightConfigurationCapture): HindsightClient;
  monotonic?: () => number;
  now?: () => string;
  nonce?: () => string;
}
interface Entry {
  sequence: number;
  capture: HindsightConfigurationCapture;
  result: HindsightConfigurationStatus;
  expires: number;
  controller: AbortController;
  pending?: Promise<HindsightConfigurationStatus>;
}
interface State {
  deps: HindsightConfigurationServiceDeps;
  entries: Map<string, Entry>;
  monotonic(): number;
  now(): string;
  nonce(): string;
  disposed: boolean;
  sequence: number;
  sessions: Map<string, { id: string; sequence: number }>;
}

export function createHindsightConfigurationService(deps: HindsightConfigurationServiceDeps): HindsightConfigurationService {
  const state: State = { deps, entries: new Map(), monotonic: deps.monotonic ?? (() => performance.now()),
    now: deps.now ?? (() => new Date().toISOString()), nonce: deps.nonce ?? randomUUID, disposed: false,
    sequence: 0, sessions: new Map() };
  return { status: ({ scope }) => status(state, scope), observe: ({ scope }) => observe(state, scope), dispose: () => {
    state.disposed = true;
    for (const entry of state.entries.values()) entry.controller.abort();
    state.entries.clear();
    state.sessions.clear();
  } };
}

function capture(state: State, scope: HindsightConfigurationScope): HindsightConfigurationCapture | null {
  if (state.disposed) return null;
  try { return state.deps.read(scope); }
  catch { return null; }
}

function empty(scope: HindsightConfigurationScope, current: HindsightConfigurationCapture | null,
  reason: HindsightConfigurationStatus["reason"] = "not_observed"): HindsightConfigurationStatus {
  const desired = safeHindsightDesiredConfiguration(current?.connection.model);
  return { scope, status: current ? "not_observed" : "unavailable", reason: current ? reason : "connection_unavailable",
    bankId: current?.bankId ?? null, desired, observation: null, comparison: compareHindsightConfiguration(desired, null),
    identity: current?.providerLineage && current.bankGeneration ? "pinned" : "unpinned",
    observationId: null, receivedAt: null, validForMs: 0 };
}

function invalidate(entry: Entry, reason: HindsightConfigurationStatus["reason"]): void {
  entry.result = { ...entry.result, status: "stale", reason, observation: null,
    comparison: compareHindsightConfiguration(entry.result.desired, null), validForMs: 0 };
  entry.expires = 0;
}

function status(state: State, scope: HindsightConfigurationScope): HindsightConfigurationStatus {
  const current = capture(state, scope);
  const entry = state.entries.get(JSON.stringify(scope));
  if (!current) return empty(scope, null);
  if (!entry) return empty(scope, current);
  if (entry.capture.contextIdentity !== current.contextIdentity) {
    entry.controller.abort();
    invalidate(entry, "context_changed");
    return { ...empty(scope, current), status: "stale", reason: "context_changed" };
  }
  const remaining = Math.max(0, Math.ceil(entry.expires - state.monotonic()));
  if (entry.result.status === "observed" && remaining === 0) invalidate(entry, "expired");
  return HindsightConfigurationStatusSchema.parse({ ...entry.result, validForMs: entry.result.status === "observed" ? remaining : 0 });
}

function observe(state: State, scope: HindsightConfigurationScope): Promise<HindsightConfigurationStatus> {
  const current = capture(state, scope);
  if (!current) return Promise.resolve(empty(scope, null));
  const key = JSON.stringify(scope);
  const prior = state.entries.get(key);
  if (prior?.pending && prior.capture.contextIdentity === current.contextIdentity) return prior.pending;
  prior?.controller.abort();
  const entry: Entry = { sequence: ++state.sequence, capture: current, result: empty(scope, current), expires: 0, controller: new AbortController() };
  state.entries.set(key, entry);
  // Bound both retained evidence and outstanding reads; evicted responses cannot publish back.
  if (state.entries.size > 64) {
    const oldest = state.entries.keys().next().value;
    if (oldest !== undefined) { state.entries.get(oldest)?.controller.abort(); state.entries.delete(oldest); }
  }
  entry.pending = perform(state, entry).then((result) => {
    if (state.entries.get(key) !== entry) return status(state, scope);
    if (capture(state, scope)?.contextIdentity !== current.contextIdentity) {
      invalidate(entry, "context_changed");
      return status(state, scope);
    }
    if (result.observation && !acceptSession(state, entry, result.observation)) {
      invalidate(entry, "runtime_changed"); return status(state, scope);
    }
    entry.result = result;
    entry.expires = result.status === "observed" ? state.monotonic() + HINDSIGHT_CONFIGURATION_TTL_MS : 0;
    return status(state, scope);
  }).finally(() => { entry.pending = undefined; });
  return entry.pending;
}

function acceptSession(state: State, current: Entry, observation: HindsightConfigurationObservation): boolean {
  const key = current.capture.connectionFingerprint;
  const session = state.sessions.get(key);
  if (session && session.sequence > current.sequence && session.id !== observation.runtimeSessionId) return false;
  state.sessions.set(key, { id: observation.runtimeSessionId, sequence: Math.max(session?.sequence ?? 0, current.sequence) });
  if (state.sessions.size > 64) {
    const first = state.sessions.keys().next().value;
    if (first !== undefined) state.sessions.delete(first);
  }
  for (const entry of state.entries.values()) {
    if (entry !== current && entry.capture.connectionFingerprint === current.capture.connectionFingerprint
      && entry.result.observation && entry.result.observation.runtimeSessionId !== observation.runtimeSessionId) {
      entry.controller.abort(); invalidate(entry, "runtime_changed");
    }
  }
  return true;
}

async function perform(state: State, entry: Entry): Promise<HindsightConfigurationStatus> {
  const controller = entry.controller;
  const deadline = setTimeout(() => controller.abort(), entry.capture.connection.requestTimeoutMs);
  try {
    const client = state.deps.client(entry.capture);
    const context = { timeoutMs: entry.capture.connection.requestTimeoutMs, signal: controller.signal };
    const manifest = await client.compatibility(context);
    if (!supportedObservation(manifest) || !client.observeConfiguration) return failure(entry, "unsupported", "capability_missing");
    if (entry.capture.providerLineage && manifest.provider.lineage !== entry.capture.providerLineage) {
      return failure(entry, "identity_mismatch", "identity_mismatch");
    }
    const nonce = state.nonce();
    const response = await client.observeConfiguration({ bankId: entry.capture.bankId, nonce, context });
    if (controller.signal.aborted) return failure(entry, "unavailable", "request_failed");
    if ("error" in response) return failure(entry, response.reason === "not_authorized" ? "not_authorized" : "unavailable",
      response.reason === "not_authorized" ? "not_authorized" : "request_failed");
    const observation = HindsightConfigurationObservationSchema.parse(response);
    if (!sameTarget(entry.capture, { manifest, observation, nonce })) return failure(entry, "identity_mismatch", "identity_mismatch");
    return { ...entry.result, status: "observed", reason: "observed", observation,
      comparison: compareHindsightConfiguration(entry.capture.connection.model, observation),
      observationId: randomUUID(), receivedAt: state.now(), validForMs: HINDSIGHT_CONFIGURATION_TTL_MS };
  } catch (error) {
    if (error instanceof HindsightError && error.code === "HINDSIGHT_AUTHENTICATION_FAILED") return failure(entry, "not_authorized", "not_authorized");
    const invalid = (error instanceof HindsightError && error.code === "HINDSIGHT_RESPONSE_INVALID")
      || (error instanceof Error && error.name === "ZodError");
    return failure(entry, "unavailable", invalid ? "invalid_response" : "request_failed");
  } finally { clearTimeout(deadline); }
}

function failure(entry: Entry, result: HindsightConfigurationStatus["status"], reason: HindsightConfigurationStatus["reason"]) {
  return { ...entry.result, status: result, reason, observation: null, validForMs: 0 };
}

function supportedObservation(manifest: HindsightCompatibilityWire): boolean {
  projectHindsightCompatibilityManifest(manifest);
  const contract = manifest.contracts.configuration_observation;
  return [HINDSIGHT_CONFIGURATION_BUILD, HINDSIGHT_TEMPLATE_BUILD, HINDSIGHT_TEMPLATE_BACKUP_BUILD].includes(manifest.source_identity.compatibility_build)
    && manifest.source_identity.upstream_commit === "4b2041eb3de5c4235f4a3dd5619fc47cce782e29"
    && contract?.version === HINDSIGHT_CONFIGURATION_VERSION
    && contract.support.state === "supported" && contract.support.reason === "all_contracts_available";
}

function sameTarget(current: HindsightConfigurationCapture, input: {
  manifest: HindsightCompatibilityWire; observation: HindsightConfigurationObservation; nonce: string;
}): boolean {
  const { manifest, observation, nonce } = input;
  return observation.nonce === nonce && observation.source.compatibilityBuild === manifest.source_identity.compatibility_build
    && observation.source.upstreamCommit === manifest.source_identity.upstream_commit
    && observation.target.bankId === current.bankId && observation.target.providerLineage === manifest.provider.lineage
    && (current.bankGeneration === null || observation.target.bankGeneration === current.bankGeneration);
}
