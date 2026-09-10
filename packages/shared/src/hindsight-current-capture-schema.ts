/**
 * INPUT:  a selected current-Local manifest and its complete repository-backed payloads
 * OUTPUT: immutable D78 capture and explicit disposition for every covered Local witness
 * POS:    shared memory contract — original Local evidence, independent of native wire and B2 history
 */
import { z } from "zod";
import { HindsightCurrentCanonicalDerivedSchema, HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalRecordSchema,
  HindsightCurrentCanonicalSourceSchema } from "./hindsight-current-canonical-schema.ts";
import { HindsightLocalCoverageManifestSchema, HindsightLocalCoverageRecordSchema,
  HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS } from "./hindsight-local-coverage-schema.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().min(1).max(256);
export const HindsightCurrentDispositionSchema = z.strictObject({
  witness: HindsightLocalCoverageRecordSchema,
  destination: z.enum(["native-object", "taki-artifact"]),
  nativeKind: z.enum(["document", "memory_unit", "mental_model", "directive"]).nullable(),
  nativeSourceId: Id.nullable(),
  // Raw repository rows preserve fields that a typed provider projection does not own.
  payloadJson: z.string().refine(isJsonObject, "capture row must be a JSON object"),
}).superRefine((value, context) => {
  if ((value.destination === "native-object") !== (value.nativeKind !== null && value.nativeSourceId !== null)) {
    context.addIssue({ code: "custom", message: "disposition target is inconsistent" });
  }
});
export type HindsightCurrentDisposition = z.infer<typeof HindsightCurrentDispositionSchema>;

export const HindsightCurrentCaptureSchema = z.strictObject({
  schemaVersion: z.literal(1), captureId: Hash, manifest: HindsightLocalCoverageManifestSchema,
  banks: z.array(HindsightCurrentCanonicalBankSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  sources: z.array(HindsightCurrentCanonicalSourceSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  records: z.array(HindsightCurrentCanonicalRecordSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  derived: z.array(HindsightCurrentCanonicalDerivedSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
  dispositions: z.array(HindsightCurrentDispositionSchema).max(HINDSIGHT_LOCAL_COVERAGE_MAX_RECORDS),
}).superRefine((value, context) => {
  const witnesses = value.manifest.records;
  if (witnesses.length !== value.dispositions.length || witnesses.some((witness, index) =>
    JSON.stringify(witness) !== JSON.stringify(value.dispositions[index]?.witness))) {
    context.addIssue({ code: "custom", message: "capture must dispose every manifest witness exactly once" });
  }
  const epoch = value.manifest.localEpochId;
  if ([...value.banks, ...value.sources, ...value.derived, ...value.records.map((record) => record.unit)]
    .some((object) => object.authorityEpochId !== epoch)) {
    context.addIssue({ code: "custom", message: "capture object belongs to another Local epoch" });
  }
  const expected = witnesses.filter((row) => ["bank", "source", "unit", "derived"].includes(row.kind))
    .map((row) => JSON.stringify([row.kind, row.bankId, row.objectId, row.relatedId])).sort();
  const actual = [
    ...value.banks.map((row) => ["bank", row.bankId, row.bankId, null]),
    ...value.sources.map((row) => ["source", row.bankId, row.documentId, null]),
    ...value.records.map(({ unit }) => ["unit", unit.bankId, unit.memoryId, null]),
    ...value.derived.map((row) => ["derived", row.bankId, row.payload.kind === "mental_model" ? row.payload.mentalModelId : row.payload.directiveId, row.payload.kind]),
  ].map((identity) => JSON.stringify(identity)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) context.addIssue({ code: "custom", message: "typed capture set is incomplete" });
});
export type HindsightCurrentCapture = z.infer<typeof HindsightCurrentCaptureSchema>;

function isJsonObject(value: string): boolean {
  try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed); }
  catch { return false; }
}
