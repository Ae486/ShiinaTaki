/**
 * INPUT:  selected Hindsight marker, full publication proof and validated current replica checkpoints
 * OUTPUT: full binding proof, live authority checks and stamp-keyed evidence with schema-keyed trigger verification
 * POS:    Core runtime evidence owner — only committed evidence is memoized; current control and full proof stay independent
 */
import type { TakiApplicationNamespace } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { requireTransitionTargetReady } from "../../db/memory-transition-native-outcome.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import type { Database } from "../../db/sqlite.ts";
import { HINDSIGHT_RUNTIME_IDENTITY_STAMP_SQL, HINDSIGHT_RUNTIME_IDENTITY_TOKEN_SQL } from "../../db/migrations/061-hindsight-runtime-identity.ts";
import { readCurrentMemoryAuthorityIdentity, readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";

interface CheckpointFloor {
  bankId: string;
  namespace: TakiApplicationNamespace;
  nativeCursor: number;
  applicationCursor: number;
}

interface CurrentEvidenceState {
  db: Database;
  epochId: string;
  floors: CheckpointFloor[];
  readToken(): string | null;
}

interface TemplateEvidenceInput {
  identity: string | null;
  read(): string | null;
}

const IDENTITY_FIELDS = ["mode", "epochId", "snapshotId", "transactionId", "providerLineageId", "replicaCheckpointDigest",
  "transitionReceiptId", "activeProviderId", "activeProviderLineageId"] as const;

export function bindHindsightRuntimeAuthority(db: Database, epochId: string) {
  const readToken = currentIdentityTokenReader(db);
  readToken();
  const identity = readCurrentMemoryAuthorityIdentity(db);
  if (identity.mode !== "hindsight" || identity.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const floors = readVerifiedFloors(db, identity.transitionReceiptId ?? null);
  requireTransitionTargetReady(db, epochId);
  return {
    assertIdentity: () => {
      const current = readCurrentMemoryAuthorityIdentity(db);
      if (IDENTITY_FIELDS.some((key) => (current[key] ?? null) !== (identity[key] ?? null))) {
        throw new Error("MEMORY_AUTHORITY_MISMATCH");
      }
    },
    bindTemplateEvidence: (template: TemplateEvidenceInput) => currentEvidenceAssertion({ db, epochId, floors, readToken }, template),
  };
}

function currentEvidenceAssertion(state: CurrentEvidenceState, template: TemplateEvidenceInput): () => void {
  let memo: { token: string | null; identity: string | null } | undefined;
  return () => {
    const token = state.readToken();
    if (token !== null && memo?.token === token) {
      assertTemplateIdentity(memo.identity, template.identity);
      return;
    }
    const current: { token: string | null; identity: string | null } = { token: null, identity: null };
    const read = () => {
      // A writer may have committed between the fast lookup and this read snapshot.
      current.token = state.readToken();
      current.identity = template.read();
      assertTemplateIdentity(current.identity, template.identity);
      for (const floor of state.floors) assertCheckpointFloor(state.db, state.epochId, floor);
    };
    if (state.db.isTransaction) read();
    else state.db.transaction(read);
    // A surrounding transaction can still roll back both its data and its schema cookie.
    if (current.token !== null && !state.db.isTransaction) memo = current;
  };
}

function assertTemplateIdentity(current: string | null, expected: string | null): void {
  if (current !== expected) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
}

function currentIdentityTokenReader(db: Database): () => string | null {
  // Older supported copies retain independent full reads; missing 061 objects are never legacy absence.
  if (!db.prepare("SELECT 1 FROM migrations WHERE version=61").get()) return () => null;
  const statement = db.prepare(HINDSIGHT_RUNTIME_IDENTITY_STAMP_SQL);
  const verification = db.prepare(HINDSIGHT_RUNTIME_IDENTITY_TOKEN_SQL);
  let verifiedSchema: number | undefined;
  return () => {
    let row = statement.get();
    const needsVerification = row?.schema_version !== verifiedSchema;
    if (needsVerification) {
      // Use the verified token if another connection changed the schema after the cheap read.
      row = verification.get();
      if (row?.trusted !== 1) throw new Error("MEMORY_RUNTIME_IDENTITY_SCHEMA_INVALID");
    }
    if (typeof row?.stamp !== "string" || row.stamp.length !== 32) {
      throw new Error("MEMORY_RUNTIME_IDENTITY_SCHEMA_INVALID");
    }
    // A transaction's schema cookie can be reused after rollback; only remember committed verification.
    if (needsVerification && !db.isTransaction) verifiedSchema = Number(row.schema_version);
    return `${row.schema_version}:${row.stamp}`;
  };
}

function readVerifiedFloors(db: Database, receiptId: string | null): CheckpointFloor[] {
  if (receiptId === null) { readMemoryAuthoritySelection(db); return []; }
  const publication = readVerifiedTransitionPublication(db, receiptId);
  if (publication.version !== 1) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  // The full reader has already verified each current namespace against its saved native evidence.
  return publication.checkpoints.map((saved) => {
    const current = readApplicationCheckpoint(db, saved.bankId);
    if (!current) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    return { bankId: saved.bankId, namespace: current.namespace,
      nativeCursor: saved.nativeCursor, applicationCursor: saved.applicationCursor };
  });
}

function assertCheckpointFloor(db: Database, epochId: string, floor: CheckpointFloor): void {
  const current = readApplicationCheckpoint(db, floor.bankId);
  if (!current || current.authorityEpochId !== epochId || current.bankDeleted
    || current.checkpoint.native_cursor < floor.nativeCursor || current.checkpoint.state_cursor < floor.applicationCursor
    || !sameApplicationValue(current.namespace, floor.namespace)
    || !sameApplicationValue(current.native, readReplicaCheckpoint(db, floor.bankId))) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
}
