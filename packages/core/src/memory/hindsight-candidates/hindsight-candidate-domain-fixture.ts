/**
 * INPUT:  generated candidate plans and real controlling-Core SQLite/Memory Operation/Effect repositories
 * OUTPUT: isolated file-backed D1-B fixture with original admission, explicit execution and physical reopen
 * POS:    candidate test support only; no Host/service/model action; generated evidence is retained in marked temp storage
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HINDSIGHT_CANDIDATE_PROFILE, type HindsightCandidatePhysicalIdentity } from "@taki/shared";
import type { HindsightCandidateDispatch, HindsightCandidatePlan, HindsightCandidateRequest, HindsightCandidateResource } from "@taki/shared/hindsight-candidate-domain";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { createEffectRepo } from "../../db/effect-repo.ts";
import { createRunEventRepo } from "../../db/run-event-repo.ts";
import { candidateDomainHash } from "./hindsight-candidate-domain-read.ts";
import { createHindsightCandidateService, type CandidateDriverContext } from "./hindsight-candidate-service.ts";

const AT = "2026-10-28T12:00:00.000Z";
export function candidateDomainFixture() {
  const directory = mkdtempSync(join(tmpdir(), "taki-d1b-evidence-"));
  writeFileSync(join(directory, "ownership.json"), JSON.stringify({ purpose: "D1-B generated deterministic test evidence", originalData: false }));
  const path = join(directory, "controlling.sqlite");
  let db = openDatabase({ path, migrations: MIGRATIONS });
  const plan = planFixture(); let current = structuredClone(plan.guard);
  let driver: (context: CandidateDriverContext) => Promise<void> = async () => undefined;
  const make = () => createHindsightCandidateService({ db, currentGuard: () => current, resolvePlan: () => structuredClone(plan), driver: (context) => driver(context) });
  let service = make(); let operations = createMemoryOperationRepo(db, () => AT);
  const fixture = {
    path, directory, plan, get db() { return db; }, get service() { return service; }, get operations() { return operations; },
    get current() { return current; }, set current(value) { current = value; },
    setDriver(value: typeof driver) { driver = value; },
    admit(request: HindsightCandidateRequest = plan.request) {
      const existing = service.existing(request); if (existing) return existing;
      const operationId = randomUUID();
      db.transaction(() => {
        const producer = service.admit(request);
        operations.insertAdmitted({ operationId, kind: request.kind, family: "hindsight-candidate", authorityEpochId: current.authorityEpochId,
          request, producer, bootId: "fixture-original-boot" });
        service.persistAdmission({ operationId, request, producer });
      });
      return operationId;
    },
    async execute(operationId: string, settle = true) {
      const result = await service.execute({ operationId, tryClaim() {
        if (operations.get(operationId)?.state !== "admitted") return false;
        operations.transition({ operationId, expectedState: "admitted", patch: { state: "running" } }); return true;
      }, checkpoint(producer) { operations.transition({ operationId, expectedState: "running", patch: { producer } }); } });
      if (settle && operations.get(operationId)?.state === "running") operations.transition({ operationId, expectedState: "running", patch: result });
      return result;
    },
    record(operationId: string) {
      const producer = operations.get(operationId)?.producer;
      if (producer?.kind !== "candidate") throw new Error("fixture candidate producer missing");
      const record = service.read(producer.candidateId); if (!record) throw new Error("fixture candidate record missing"); return record;
    },
    dispatch(candidateId: string, action: HindsightCandidateDispatch["action"]) {
      return effectFixture(db, { candidateId, action, guard: current });
    },
    reopen() { db.close(); db = openDatabase({ path, migrations: [] }); service = make(); operations = createMemoryOperationRepo(db, () => AT); },
    close() { db.close(); },
  };
  return fixture;
}

function planFixture(): HindsightCandidatePlan {
  const backupId = randomUUID(); const digest = "a".repeat(64);
  return { version: 1, profile: HINDSIGHT_CANDIDATE_PROFILE,
    request: { kind: "candidate.prepare", requestId: randomUUID(), backupId, expectedEpochId: "current-epoch", expectedManifestHash: digest },
    source: { backupId, manifestHash: digest, coreSha256: "b".repeat(64), archiveSha256: "c".repeat(64), inventoryHash: "d".repeat(64),
      backupRequestHash: "e".repeat(64), authorityEpochId: "historical-epoch", providerLineageId: randomUUID() },
    guard: { authorityEpochId: "current-epoch", sourceAuthorityHash: digest, custodyHash: "f".repeat(64),
      host: { coreHostId: randomUUID(), executionHostId: randomUUID(), installationId: digest, engineId: "owned-engine", imageId: `sha256:${digest}` } } };
}

function effectFixture(db: ReturnType<typeof openDatabase>, input: { candidateId: string; action: HindsightCandidateDispatch["action"]; guard: HindsightCandidatePlan["guard"] }) {
  const runId = randomUUID(); const attemptId = randomUUID(); const snapshotId = randomUUID();
  db.prepare(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES (:snapshot,:run,'harness.v1','{}',:digest,:at,:at)`).run({ snapshot: snapshotId, run: runId, digest: "a".repeat(64), at: AT });
  db.prepare(`INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,
    state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at)
    VALUES (:run,'candidate-fixture',:run,:run,'fixture','primary','{}','class_a','running',1,:snapshot,:attempt,:at,'executing',:at,:at)`)
    .run({ run: runId, snapshot: snapshotId, attempt: attemptId, at: AT });
  db.prepare(`INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id)
    VALUES (:attempt,:run,1,'effect_running',1,'fixture','unused',:snapshot)`).run({ run: runId, attempt: attemptId, snapshot: snapshotId });
  const inputHash = candidateDomainHash("effect-input", { candidateId: input.candidateId, action: input.action });
  const effect = createEffectRepo(db, createRunEventRepo(db)).prepareIntent({ runId, attemptId, kind: "tool",
    sourceRef: { type: "host", operationId: "hindsight-candidate-fixture" }, replayPosture: "never", inputDigest: inputHash,
    executorRef: { type: "host", hostId: input.guard.host.executionHostId, connectionGeneration: 1 } });
  return { version: 1 as const, candidateId: input.candidateId, action: input.action, runId, attemptId, effectId: effect.effectId,
    hostRequestId: randomUUID(), inputHash, authorityHash: candidateDomainHash("guard", input.guard) };
}

export function candidateResourceFixture(candidateId: string, plan: HindsightCandidatePlan) {
  const resource: HindsightCandidateResource = { version: 1, role: "candidate", resourceId: candidateId, ...plan.guard.host,
    containerId: "1".repeat(64), volumes: [{ name: "candidate", backingId: "2".repeat(64), writableAttachments: ["1".repeat(64)] }],
    postgres: { systemIdentifier: "111111111111", database: "candidate" } };
  const identity: HindsightCandidatePhysicalIdentity = { ...resource, startupId: randomUUID(),
    listener: { address: "127.0.0.1", port: 18489, processIdentity: "3".repeat(64) } };
  const source: HindsightCandidatePhysicalIdentity = { ...identity, role: "source", resourceId: randomUUID(), containerId: "4".repeat(64),
    volumes: [{ name: "source", backingId: "5".repeat(64), writableAttachments: ["4".repeat(64)] }],
    postgres: { systemIdentifier: "222222222222", database: "source" }, listener: { address: "127.0.0.1", port: 18481, processIdentity: "6".repeat(64) } };
  return { resource, identity, sources: [source] };
}
