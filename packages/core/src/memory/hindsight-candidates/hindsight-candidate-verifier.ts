/**
 * INPUT:  complete admitted pair and an installed candidate-only observer with stopped COPY and authenticated read ports
 * OUTPUT: explicit missing evidence or exact baseline verification after fresh identity, environment and full-row checks
 * POS:    experimental D1 contract; D1-C/D supply the actual observer; no boot, restore, model work or source promotion
 */
import { HindsightCandidateProvenanceSchema, HindsightCandidateSchemaInventorySchema, HindsightCandidateVerificationSchema,
  type HindsightCandidateOwnership, type HindsightCandidatePhysicalIdentity, type HindsightCandidateProvenance,
  type HindsightCandidateSchemaInventory, type HindsightCandidateVerification } from "@taki/shared";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { preflightHindsightRestore } from "../hindsight-backup/hindsight-backup-preflight.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { admitHindsightCandidateArchive, type CandidateAdmissionInput } from "./hindsight-candidate-admission.ts";
import { verifyCandidateIdentity } from "./hindsight-candidate-identity.ts";
import { CopyStreamDecoder } from "./hindsight-candidate-copy-stream.ts";
import { assertCompletedCore, assertCandidateDigest, candidateDigest } from "./hindsight-candidate-files.ts";
import { refuse, refusalOf } from "./hindsight-candidate-refusal.ts";

/** Internal producer port, not a public DTO or evidence issuer. D1-C/D must prove its installed provenance. */
export interface CandidateObserver {
  observe(): Promise<{ candidate: HindsightCandidatePhysicalIdentity; sources: HindsightCandidatePhysicalIdentity[];
    sourceAuthorityHash: string; schema: HindsightCandidateSchemaInventory; provenance: HindsightCandidateProvenance | null }>;
  /** Installed session lifetime guard; replacement revokes the session even if resources later compare equal. */
  assertCurrent(): void;
  /** Each call opens a new read-only repeatable-read snapshot, including its complete actual schema. */
  openInventory?: () => Promise<CandidateInventorySnapshot>;
  /** Receives only the validated Host-derived endpoint; must use the installed authenticated read transport. */
  client?: (endpoint: string) => HindsightClient;
}

export interface CandidateInventorySnapshot {
  schema: HindsightCandidateSchemaInventory;
  copyTable(name: string): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

type Admitted = Awaited<ReturnType<typeof admitHindsightCandidateArchive>>;
type Identity = ReturnType<typeof verifyCandidateIdentity>;
interface VerificationInput extends CandidateAdmissionInput {
  ownership: HindsightCandidateOwnership; observer?: CandidateObserver; signal?: AbortSignal;
  missingCredentials: Parameters<typeof preflightHindsightRestore>[0]["missingCredentials"];
}

export async function verifyHindsightCandidate(input: VerificationInput): Promise<HindsightCandidateVerification> {
  // Freeze public data before the first await; a caller cannot alter the admitted contract while reads run.
  const frozen = { ...structuredClone({ corePath: input.corePath, archivePath: input.archivePath,
    manifest: input.manifest, targetSchema: input.targetSchema, ownership: input.ownership }),
    observer: input.observer, signal: input.signal, missingCredentials: input.missingCredentials };
  try {
    const admitted = await admitHindsightCandidateArchive(frozen);
    if (!frozen.observer) return HindsightCandidateVerificationSchema.parse({ version: 1, stage: "unverified",
      candidateId: frozen.ownership.candidateId, inventoryHash: admitted.inventoryHash, identityHash: null,
      missing: ["physical_identity", "restored_equality", "fresh_template_observation", "environment_provenance"] });
    return await verifyObserved(frozen, admitted, frozen.observer);
  } catch (error) {
    return HindsightCandidateVerificationSchema.parse({ version: 1, stage: "refused", candidateId: frozen.ownership.candidateId,
      refusal: refusalOf(error, ["unreadable", "restore"]).refusal });
  }
}

async function verifyObserved(input: VerificationInput, admitted: Admitted, observer: CandidateObserver) {
  const before = structuredClone(await observer.observe());
  const identity = verifyCandidateIdentity({ ownership: input.ownership, ...before });
  observer.assertCurrent();
  assertObservedSchema(before.schema, admitted);
  if (!/^[a-f0-9]{64}$/.test(before.sourceAuthorityHash)) refuse("unreadable", "identity");
  const missing: Array<"restored_equality" | "fresh_template_observation" | "environment_provenance"> = [];
  if (!before.provenance) missing.push("environment_provenance");
  else assertProvenance(before.provenance, admitted, identity);
  if (!observer.openInventory) missing.push("restored_equality");
  else await verifyRows(admitted, observer, input.signal);
  let templates: Awaited<ReturnType<typeof preflightHindsightRestore>> | null = null;
  // The validation service is not contacted until its no-execution/environment proof is present.
  if (!observer.client || !before.provenance || !observer.openInventory) missing.push("fresh_template_observation");
  else {
    await assertCompletedCore(input.corePath);
    templates = await preflightHindsightRestore({ corePath: input.corePath, manifest: input.manifest,
      client: observer.client(identity.endpoint), missingCredentials: input.missingCredentials, signal: input.signal });
    observer.assertCurrent();
    await verifyRows(admitted, observer, input.signal);
  }
  const after = structuredClone(await observer.observe());
  verifyCandidateIdentity({ ownership: input.ownership, ...after });
  if (!templateEqual(before, after)) refuse("tampered", "identity");
  await assertCompletedCore(input.corePath);
  assertCandidateDigest(await candidateDigest(input.corePath, "core"), admitted.inventory.core, "core");
  assertCandidateDigest(await candidateDigest(input.archivePath, "archive"), admitted.inventory.archive, "archive");
  input.signal?.throwIfAborted();
  observer.assertCurrent();
  const common = { version: 1, candidateId: input.ownership.candidateId, inventoryHash: admitted.inventoryHash, identityHash: identity.identityHash };
  if (missing.length) return HindsightCandidateVerificationSchema.parse({ ...common, stage: "unverified", missing });
  if (!templates) refuse("unreadable", "template");
  return HindsightCandidateVerificationSchema.parse({ ...common, stage: "baseline_verified", requestHash: templates.requestHash,
    nativeSchema: templates.nativeSchema, observedTemplates: templates.observations.length });
}

function assertObservedSchema(schema: HindsightCandidateSchemaInventory, admitted: Admitted) {
  const parsed = HindsightCandidateSchemaInventorySchema.safeParse(schema);
  if (!parsed.success) refuse("unreadable", "schema");
  parsed.data.tables.sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (transitionLocalHash(parsed.data) !== admitted.inventory.targetSchemaHash) refuse("unsupported", "schema");
}

function assertProvenance(raw: HindsightCandidateProvenance, admitted: Admitted, identity: Identity) {
  const parsed = HindsightCandidateProvenanceSchema.safeParse(raw);
  if (!parsed.success) refuse("unsupported", "schema");
  const value = parsed.data;
  // Historical source provenance must come from capture evidence, not today's source or the restored target.
  if (value.archiveSha256 !== admitted.inventory.archive.sha256 || value.sourceCapture.backupId !== admitted.inventory.backupId
    || value.sourceCapture.requestHash !== admitted.inventory.requestHash || value.sourceCapture.coreSha256 !== admitted.inventory.core.sha256
    || value.candidateIdentityHash !== identity.identityHash) refuse("foreign", "identity");
  if (!templateEqual(value.source, value.candidate)) refuse("unsupported", "schema");
}

async function verifyRows(admitted: Admitted, observer: CandidateObserver, signal?: AbortSignal) {
  observer.assertCurrent();
  if (!observer.openInventory) refuse("unreadable", "restore");
  const snapshot = await observer.openInventory();
  try {
    observer.assertCurrent(); assertObservedSchema(snapshot.schema, admitted);
    for (const table of admitted.inventory.tables) {
      signal?.throwIfAborted(); observer.assertCurrent();
      const decoder = new CopyStreamDecoder({ fields: table.columns.length });
      for await (const chunk of snapshot.copyTable(table.name)) { signal?.throwIfAborted(); observer.assertCurrent(); decoder.push(chunk); }
      observer.assertCurrent();
      const actual = decoder.finish();
      if (actual.rows !== table.rows || actual.rowsDigest !== table.rowsDigest) refuse("tampered", "table", { name: table.name });
    }
  } finally { await snapshot.close(); }
}
