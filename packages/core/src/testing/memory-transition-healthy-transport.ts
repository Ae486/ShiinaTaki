/**
 * INPUT:  complete deterministic native evidence and the actual Core driver's original commands
 * OUTPUT: history-preserving native transport double with programmable reply loss
 * POS:    core/testing — checks Core orchestration only; never certifies native maintenance
 */
import { randomUUID } from "node:crypto";
import { HINDSIGHT_TRANSITION_BUILD, type HindsightTransitionAcquire, type HindsightTransitionStatus, type HindsightTransitionUnusedScope,
  type MemoryTransitionNativeEvidence } from "@taki/shared";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { HindsightTransitionRefusal } from "../memory/hindsight/hindsight-transition-client.ts";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import { hindsightApplicationBytesHash, hindsightApplicationHash } from "../memory/hindsight/hindsight-application-integrity.ts";
import { sealTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { applicationTestCompatibility } from "./hindsight-application-runtime-fixtures.ts";
import { transitionOutcomeFixture } from "./memory-transition-outcome-fixtures.ts";
import { transitionFinalFixture } from "./memory-transition-final-fixtures.ts";
import { readTransitionPreparation } from "../db/memory-transition-delta-repo.ts";
import type { Database } from "../db/sqlite.ts";
import { createHealthySourceTransport } from "./memory-transition-healthy-source-transport.ts";

function transportState(initial: MemoryTransitionNativeEvidence[], db: Database) {
  const evidence = new Map<string, MemoryTransitionNativeEvidence>(); const status = new Map<string, HindsightTransitionStatus>();
  const latest = new Map(initial.map((row) => [row.status.bank_id, row]));
  const deltas = new Map<string, ReturnType<typeof transitionFinalFixture>["result"]>();
  const maintenance = new Map<string, Map<number, number>>();
  const unused = new Map<string, HindsightTransitionUnusedScope>();
  const key = (bank: string, transition: string) => JSON.stringify([bank, transition]);
  const current = (bank: string, transition: string) => {
    const value = status.get(key(bank, transition));
    if (!value) throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "transition_not_found" }); return value;
  };
  const calls = { acquire: 0, verify: 0, resolve: 0, claim: 0, delta: 0 };
  const fault = { acquireReply: false, resolveReply: false, verifyReply: false, deltaReply: false, sourceSealReply: false, partialMaintenance: false, unavailable: false };
  const available = () => { if (fault.unavailable) throw new Error("owned transport unavailable"); };
  const sources = createHealthySourceTransport({ available, sealed: () => {
    if (fault.sourceSealReply) { fault.sourceSealReply = false; fault.unavailable = true; throw new Error("owned lost Source seal reply"); }
  } });
  const find = (predicate: (value: MemoryTransitionNativeEvidence) => boolean) => [...evidence.values(), ...latest.values(), ...initial].find(predicate)!;
  const manifest = applicationTestCompatibility({ bankId: initial[0]!.status.bank_id, namespace: initial[0]!.status.proof!.application_snapshot.namespace });
  manifest.source_identity.compatibility_build = HINDSIGHT_TRANSITION_BUILD;
  const versioned = { version: "1.0.0", support: { state: "supported" as const, reason: "all_contracts_available" as const } };
  manifest.contracts.transitions = versioned; manifest.contracts.transition_source_evidence = versioned;
  return { db, evidence, status, latest, deltas, maintenance, unused, sources, key, current, calls, fault, available, find, manifest };
}
type State = ReturnType<typeof transportState>;
export function createHealthyTransitionTransport(initial: MemoryTransitionNativeEvidence[], db: Database) {
  const state = transportState(initial, db);
  const client: HindsightClient = { ...createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture-key",
    transport: async () => { throw new Error("unprogrammed native endpoint"); } }),
    ...controlMethods(state), ...effectMethods(state), ...readMethods(state), ...state.sources.client };
  const { manifest, fault, calls, evidence, status, maintenance } = state;
  return { client, manifest, fault, calls, evidence, status, maintenance, sources: state.sources,
    reconnectDatabase: (database: Database) => { state.db = database; },
    registerUnused: (value: MemoryTransitionNativeEvidence, proof: HindsightTransitionUnusedScope) => {
      state.latest.set(value.status.bank_id, value); state.unused.set(value.status.bank_id, proof);
    } };
}
function controlMethods(state: State): Partial<HindsightClient> {
  const { available, calls, latest, evidence, status, key, fault, current, manifest } = state;
  return {
    health: async () => { available(); return { status: "healthy", database: "connected" }; },
    version: async () => { available(); return { apiVersion: "0.9.0" }; },
    compatibility: async () => { available(); return structuredClone(manifest); },
    unusedTransitionScope: async (input) => { available(); const proof = state.unused.get(input.bankId);
      if (!proof) throw new Error("fixture Bank is not unused"); return structuredClone(proof); },
    createCurrentSnapshot: async (input) => structuredClone(latest.get(input.bankId)!.status.proof!.native_snapshot),
    createApplicationSnapshot: async (input) => structuredClone(latest.get(input.bankId)!.status.proof!.application_snapshot),
    transitionStatus: async (input: { bankId: string; transitionId: string }) => { available(); return structuredClone(current(input.bankId, input.transitionId)); },
    acquireTransition: async (input: { bankId: string; request: HindsightTransitionAcquire }) => {
      available(); calls.acquire++;
      const source = latest.get(input.bankId)!;
      const value = input.request.direction === "return-local" ? retarget(source, input.request) : null;
      if (value) evidence.set(key(input.bankId, input.request.transition_id), value);
      const acquired: HindsightTransitionStatus = { ...source.status, request: input.request,
        executor: value?.status.executor ?? { transition_id: input.request.transition_id, attempt_id: input.request.attempt_id, generation: 1, fence_token: randomUUID() },
        phase: "draining", revision: 1, proof: null, outcome: null };
      status.set(key(input.bankId, input.request.transition_id), acquired);
      if (fault.acquireReply) { fault.acquireReply = false; fault.unavailable = true; throw new Error("lost acquire reply"); }
      return structuredClone(acquired);
    },
    fenceTransition: async (input: { bankId: string; request: HindsightTransitionStatus["executor"] }) => {
      available(); const value = current(input.bankId, input.request.transition_id);
      value.phase = "fenced"; value.revision++; return structuredClone(value);
    },
    renewTransition: async (input: { bankId: string; request: HindsightTransitionStatus["executor"] }) => {
      available(); return structuredClone(current(input.bankId, input.request.transition_id));
    },
    claimTransition: async (input: Parameters<NonNullable<ReturnType<typeof createHindsightClient>["claimTransition"]>>[0]) => {
      available(); calls.claim++; const value = current(input.bankId, input.transitionId);
      value.executor = { ...value.executor, attempt_id: input.request.attempt_id, generation: value.executor.generation + 1, fence_token: randomUUID() };
      value.executor_live = true; value.revision++; return structuredClone(value);
    },
  };
}
function effectMethods(state: State): Partial<HindsightClient> {
  const { available, deltas, key, calls, latest, evidence, fault, status, current, maintenance } = state;
  return {
    transitionDelta: async (input: { bankId: string; transitionId: string }) => { available(); return deltas.get(key(input.bankId, input.transitionId)) ?? null; },
    applyTransitionDelta: async (input: Parameters<NonNullable<ReturnType<typeof createHindsightClient>["applyTransitionDelta"]>>[0]) => {
      available(); calls.delta++;
      const prepared = state.db.prepare("SELECT id FROM memory_transition_preparations WHERE transition_id=:id")
        .all({ id: input.request.executor.transition_id }).map((row) => readTransitionPreparation(state.db, String(row.id)))
        .find((row) => row.scope.nativeBankId === input.bankId)!;
      const uploads = prepared.request.application.flatMap((row) => row.body?.artifact_kind === "source_evidence"
        ? [state.sources.bodies.get(row.body.body.source_ref.body_id)!] : []);
      const value = transitionFinalFixture(prepared, latest.get(input.bankId)!, uploads);
      evidence.set(key(input.bankId, prepared.transitionId), value.evidence); deltas.set(key(input.bankId, prepared.transitionId), value.result);
      if (fault.deltaReply) { fault.deltaReply = false; fault.unavailable = true; throw new Error("lost delta reply"); }
      return structuredClone(value.result);
    },
    verifyTransition: async (input: { bankId: string; request: HindsightTransitionStatus["executor"] }) => {
      available(); calls.verify++;
      const planKey = key(input.bankId, input.request.transition_id);
      const steps = maintenance.get(planKey) ?? new Map<number, number>(); maintenance.set(planKey, steps);
      for (let step = 0; step < (fault.partialMaintenance ? 9 : 11); step++) if (!steps.has(step)) steps.set(step, 1);
      if (fault.partialMaintenance) throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "native_maintenance_incomplete" });
      const value = verifiedExecutor(evidence.get(planKey)!, current(input.bankId, input.request.transition_id).executor);
      evidence.set(planKey, value);
      status.set(key(input.bankId, input.request.transition_id), value.status);
      if (fault.verifyReply) { fault.verifyReply = false; fault.unavailable = true; throw new Error("lost verify reply"); }
      return structuredClone(value.status);
    },
    resolveTransition: async (input: Parameters<NonNullable<ReturnType<typeof createHindsightClient>["resolveTransition"]>>[0]) => {
      available(); calls.resolve++; const prior = current(input.bankId, input.request.executor.transition_id);
      if (input.request.disposition === "abort" && !prior.proof && maintenance.has(key(input.bankId, input.request.executor.transition_id))) {
        throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "native_maintenance_incomplete" });
      }
      if (prior.proof && input.request.proof_hash !== prior.proof.proof_hash) {
        throw new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "proof_mismatch" });
      }
      const value = transitionOutcomeFixture(prior, input.request.core_receipt_id);
      value.outcome!.request = input.request;
      const body = Object.fromEntries(Object.entries(value.outcome!).filter(([field]) => field !== "outcome_hash"));
      value.outcome!.outcome_hash = hindsightTransitionHash(body);
      status.set(key(input.bankId, input.request.executor.transition_id), value);
      if (input.request.disposition !== "abort") latest.set(input.bankId, evidence.get(key(input.bankId, input.request.executor.transition_id))!);
      if (fault.resolveReply) { fault.resolveReply = false; fault.unavailable = true; throw new Error("lost resolve reply"); }
      return structuredClone(value);
    },
  };
}
function readMethods(state: State): Partial<HindsightClient> {
  const { find, evidence, key } = state;
  return {
    currentSnapshotPage: async (input: { snapshotId: string; pageNumber: number }) => structuredClone(find((row) => row.status.proof!.native_snapshot.snapshot_id === input.snapshotId).nativePages[input.pageNumber]!),
    applicationSnapshotPage: async (input: { snapshotId: string; pageNumber: number }) => structuredClone(find((row) => row.status.proof!.application_snapshot.snapshot_id === input.snapshotId).applicationPages[input.pageNumber]!),
    transitionEvidence: async (input: { bankId: string; transitionId: string; pageNumber: number }) => structuredClone(evidence.get(key(input.bankId, input.transitionId))!.maintenancePages[input.pageNumber]!),
    transitionAuxiliary: async (input: { bankId: string; transitionId: string; pageNumber: number }) => structuredClone(evidence.get(key(input.bankId, input.transitionId))!.auxiliaryPages[input.pageNumber]!),
    applicationBody: async (input: { bankId: string; bodyId: string }) => {
      const bundle = find((row) => row.bodies.some((body) => body.ref.body_id === input.bodyId));
      const body = bundle.bodies.find((row) => row.ref.body_id === input.bodyId)!;
      return { bank_id: input.bankId, namespace: bundle.status.proof!.application_snapshot.namespace,
        descriptor: body.ref, state: "sealed" as const, received_parts: body.ref.total_parts, expires_at: null };
    },
    applicationBodyPart: async (input: { bankId: string; bodyId: string; partNumber: number }) => {
      const bundle = find((row) => row.bodies.some((body) => body.ref.body_id === input.bodyId));
      const body = bundle.bodies.find((row) => row.ref.body_id === input.bodyId)!;
      const bytes = Buffer.from(body.base64, "base64").subarray(input.partNumber * body.ref.part_bytes, (input.partNumber + 1) * body.ref.part_bytes);
      const namespace = bundle.status.proof!.application_snapshot.namespace;
      const part = { namespace, bank_id: input.bankId, body_id: input.bodyId, part_number: input.partNumber,
        part_sha256: hindsightApplicationBytesHash(bytes), total_bytes: bytes.length };
      return { ...part, part_hash: hindsightApplicationHash({ bankId: input.bankId, namespace, domain: "part", value: part }), data_base64: bytes.toString("base64") };
    },
  };
}
function retarget(source: MemoryTransitionNativeEvidence, request: HindsightTransitionAcquire) {
  const value = structuredClone(source); value.transitionId = request.transition_id;
  const executor = { transition_id: request.transition_id, attempt_id: request.attempt_id, generation: 1, fence_token: randomUUID() };
  value.status = { ...value.status, request, executor };
  const proof = value.status.proof!; proof.certificate_id = request.transition_id; proof.executor = executor; proof.request_hash = request.request_hash;
  proof.delta_result_hash = null; proof.unused_scope_hash = null; value.status.outcome = null; value.status.phase = "proven";
  const body = Object.fromEntries(Object.entries(proof).filter(([field]) => field !== "proof_hash"));
  proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1", proof: body });
  for (const page of value.maintenancePages) { page.verification_id = request.transition_id; page.certificate_hash = proof.proof_hash; }
  for (const page of value.auxiliaryPages) { page.transition_id = request.transition_id; page.proof_hash = proof.proof_hash; }
  return sealTransitionNativeEvidence(value);
}
function verifiedExecutor(source: MemoryTransitionNativeEvidence, executor: HindsightTransitionStatus["executor"]) {
  const value = structuredClone(source); value.status.executor = executor;
  const proof = value.status.proof!; proof.executor = executor;
  proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1", proof: Object.fromEntries(Object.entries(proof).filter(([field]) => field !== "proof_hash")) });
  for (const page of value.maintenancePages) page.certificate_hash = proof.proof_hash;
  for (const page of value.auxiliaryPages) page.proof_hash = proof.proof_hash;
  return sealTransitionNativeEvidence(value);
}
