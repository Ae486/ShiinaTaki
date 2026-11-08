/**
 * INPUT:  generated lifecycle/capture data, deterministic Native transport and explicit synthetic COPY rows
 * OUTPUT: nonempty file/SQLite fixtures; synthetic schema/physical evidence is never runtime acceptance
 * POS:    candidate test support only; calls existing test producers, retains completed test artifacts for diagnosis
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { HindsightBackupManifestV2Schema, PendingMemoryIntentSchema, type HindsightCandidateArchiveManifest,
  type HindsightCandidateSchemaInventory, type HindsightCandidateOwnership, type HindsightCandidatePhysicalIdentity } from "@taki/shared";
import { templateBackupConsumerFixture } from "../../testing/hindsight-template-backup-consumer-fixture.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { HINDSIGHT_CANDIDATE_ALEMBIC, HINDSIGHT_CANDIDATE_UPSTREAM, HINDSIGHT_CANDIDATE_TABLES,
  HINDSIGHT_CANDIDATE_CLASSIFIED, HINDSIGHT_CANDIDATE_BUILD, HINDSIGHT_CANDIDATE_CORE_HEAD } from "./hindsight-candidate-profile.ts";

export const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export function binaryCopy(rows: Array<Array<Uint8Array | null>>, flags = 0, extension = Buffer.alloc(0)) {
  const header = Buffer.alloc(19); Buffer.from("PGCOPY\n\xff\r\n\0", "latin1").copy(header);
  header.writeUInt32BE(flags, 11); header.writeInt32BE(extension.length, 15);
  const parts = [header, extension];
  for (const row of rows) {
    const count = Buffer.alloc(2); count.writeInt16BE(row.length); parts.push(count);
    for (const field of row) {
      const length = Buffer.alloc(4); length.writeInt32BE(field === null ? -1 : field.length); parts.push(length);
      if (field !== null) parts.push(Buffer.from(field));
    }
  }
  parts.push(Buffer.from([255, 255])); return Buffer.concat(parts);
}

export async function candidateFixture(scenario: "selected" | "removed" = "selected", coreMigrationHead = HINDSIGHT_CANDIDATE_CORE_HEAD) {
  const h = await templateBackupConsumerFixture(scenario, coreMigrationHead);
  const directory = mkdtempSync(join(tmpdir(), "taki-d1a-evidence-"));
  try {
    seedPending(h);
    const capture = await h.joint.capture();
    if (capture.staged.request.version !== 2) throw new Error("candidate fixture requires v2 capture");
    const observed = await h.observer.client.observeTemplateBackup({ request: { version: 2, nonce: randomUUID(), request: capture.staged.request },
      context: { timeoutMs: 1000 } });
    observed.proof.alembicRevision = HINDSIGHT_CANDIDATE_ALEMBIC; observed.proof.upstreamCommit = HINDSIGHT_CANDIDATE_UPSTREAM;
    const columns = fixtureColumns(); const streams = fixtureStreams(columns);
    const native: HindsightCandidateArchiveManifest = { version: "2", created_at: h.joint.fixture.state.now, schema: observed.schema,
      tables: Object.fromEntries([...columns].map(([name, cols]) => [name, { rows: 2, size_bytes: streams[name]!.length,
        columns: cols.map(({ name, typeName }) => ({ name, type_name: typeName })) }])),
      taki: { version: 2, backupId: capture.backupId, requestHash: capture.staged.request.requestHash, proof: observed.proof,
        entries: Object.entries(streams).map(([name, bytes]) => ({ name: `${name}.bin`, bytes: bytes.length, sha256: digest(bytes) })) } };
    const targetSchema: HindsightCandidateSchemaInventory = { schema: observed.schema, alembicRevision: HINDSIGHT_CANDIDATE_ALEMBIC,
      compatibilityBuild: HINDSIGHT_CANDIDATE_BUILD, upstreamCommit: HINDSIGHT_CANDIDATE_UPSTREAM,
      tables: [...columns].map(([name, columns]) => ({ name, columns })).concat([...HINDSIGHT_CANDIDATE_CLASSIFIED.keys()]
        .map((name) => ({ name, columns: [{ name: "metadata", typeName: "text" }] }))) };
    const corePath = join(directory, "core.sqlite"); copyFileSync(capture.corePath, corePath);
    const archivePath = join(directory, "native.zip"); const bytes = writeCandidateZip(archivePath, native, streams);
    const manifest = HindsightBackupManifestV2Schema.parse({ ...capture.staged.core, route: "operator-artifact", sensitive: true,
      verifiedAt: h.joint.fixture.state.now, native: { location: "core-dir", file: "native.zip", nativeManifestVersion: "2", schema: observed.schema,
        proof: { ...observed.proof, zipSha256: digest(bytes), zipBytes: bytes.length } } });
    const original = h.observer.client.observeTemplateBackup;
    const client: HindsightClient = { ...h.source.native.client, observeTemplateBackup: async (input: Parameters<typeof original>[0]) => {
      const reply = await original(input); reply.proof.alembicRevision = HINDSIGHT_CANDIDATE_ALEMBIC;
      reply.proof.upstreamCommit = HINDSIGHT_CANDIDATE_UPSTREAM; return reply;
    } };
    return { h, directory, corePath, archivePath, manifest, targetSchema, native, streams, client, close: h.close };
  } catch (error) { await h.close(); throw error; }
}

function seedPending(h: Awaited<ReturnType<typeof templateBackupConsumerFixture>>) {
  const bank = h.joint.fixture.base.banks[0]!; const at = h.joint.fixture.state.now;
  createPendingMemoryRepo(h.joint.fixture.db, () => at, (bankId) => h.joint.fixture.base.replica.bankBinding(bankId)?.bank)
    .enqueue(PendingMemoryIntentSchema.parse({ schemaVersion: 1, authorityEpochId: "epoch",
    providerId: "hindsight", providerLineageId: bank.scope.namespace.provider_lineage, bankGeneration: bank.scope.namespace.bank_generation,
    bank: { bankId: bank.scope.bankId, scope: "global", characterId: null }, operationId: "candidate-pending-source", originalAt: at, baseCursor: 1,
    operation: { kind: "retain", zeroResultAllowed: true, request: { bankId: bank.scope.bankId, content: "Keep the original queued source body.",
      context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
      provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at,
        sanitized: true, sourceRef: null }, policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null,
        origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } } } }));
}

function fixtureColumns() {
  const columns = new Map<string, HindsightCandidateSchemaInventory["tables"][number]["columns"]>();
  for (const name of HINDSIGHT_CANDIDATE_TABLES.keys()) columns.set(name, [{ name: "id", typeName: "text" }, { name: "payload", typeName: "text" }]);
  columns.set("documents", [{ name: "id", typeName: "text" }, { name: "file_storage_key", typeName: "text" }]);
  columns.set("file_storage", [{ name: "storage_key", typeName: "text" }, { name: "data", typeName: "bytea" }]);
  for (const name of ["memory_units", "mental_models"]) columns.set(name, [{ name: "id", typeName: "text" }, { name: "embedding", typeName: "vector(3)" }]);
  return columns;
}

function fixtureStreams(columns: ReturnType<typeof fixtureColumns>) {
  return Object.fromEntries([...columns.keys()].map((name) => {
    const row = (number: number) => name === "documents" ? [Buffer.from(`document-${number}`), Buffer.from(`file-${number}`)]
      : name === "file_storage" ? [Buffer.from(`file-${number}`), Buffer.from([0, 255, number])]
        : [Buffer.from(`${name}-${number}`), Buffer.from(`preserved-${name}-${number}`)];
    return [name, binaryCopy([row(1), row(2)])];
  }));
}

export function writeCandidateZip(path: string, manifest: HindsightCandidateArchiveManifest, streams: Record<string, Uint8Array>) {
  const entries = Object.fromEntries(Object.entries(streams).map(([name, bytes]) => [`${name}.bin`, bytes]));
  const bytes = Buffer.from(zipSync({ ...entries, "manifest.json": strToU8(JSON.stringify(manifest)) }));
  writeFileSync(path, bytes); return bytes;
}

export function candidateIdentities() {
  const ownership: HindsightCandidateOwnership = { candidateId: randomUUID(), coreHostId: randomUUID(), executionHostId: randomUUID(),
    installationId: "2".repeat(64), engineId: "owned-engine", imageId: `sha256:${"a".repeat(64)}` };
  const candidate: HindsightCandidatePhysicalIdentity = { version: 1, role: "candidate", resourceId: ownership.candidateId,
    coreHostId: ownership.coreHostId, executionHostId: ownership.executionHostId, installationId: ownership.installationId,
    engineId: ownership.engineId, imageId: ownership.imageId, containerId: "b".repeat(64), startupId: randomUUID(),
    volumes: [{ name: "candidate-volume", backingId: "c".repeat(64), writableAttachments: ["b".repeat(64)] }],
    postgres: { systemIdentifier: "12345678901", database: "candidate" },
    listener: { address: "127.0.0.1", port: 18489, processIdentity: "d".repeat(64) } };
  const source: HindsightCandidatePhysicalIdentity = { ...candidate, role: "source", resourceId: randomUUID(), containerId: "e".repeat(64),
    startupId: randomUUID(), volumes: [{ name: "source-volume", backingId: "f".repeat(64), writableAttachments: ["e".repeat(64)] }],
    postgres: { systemIdentifier: "12345678902", database: "source" },
    listener: { address: "127.0.0.1", port: 18481, processIdentity: "1".repeat(64) } };
  return { ownership, candidate, sources: [source] };
}
