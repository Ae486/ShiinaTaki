import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HindsightBackupNativeRequestSchema, HindsightBackupNativeProofSchema, HindsightBackupArchiveProofSchema, HindsightBackupManifestSchema,
} from "./hindsight-backup-schema.ts";
import { HindsightBackupNativeRequestV2Schema, HindsightBackupNativeProofBodyV2Schema, HindsightBackupNativeProofV2Schema,
  HindsightBackupNativeResponseV2Schema, HindsightBackupArchiveProofV2Schema, HindsightBackupManifestV2Schema,
  HindsightTemplateBackupObservationRequestSchema, HindsightTemplateBackupObservationResponseSchema } from "./hindsight-backup-v2-schema.ts";
import { HindsightTemplateBackupBankProofV2Schema, HindsightTemplateBackupFailureSchema } from "./hindsight-template-backup-schema.ts";
import { HindsightTemplateBackupAttestationSchema } from "./hindsight-template-backup-attestation-schema.ts";
import { HindsightTemplateApplyRequestSchema, HindsightTemplateReceiptSchema } from "./hindsight-template-schema.ts";
import { hindsightTemplateHashJson } from "./hindsight-template-encoding.ts";
import { hindsightTemplateBackupHashJson, hindsightBackupJsonBytes, hindsightTemplateBackupRequestValue,
  hindsightTemplateBackupReceiptsValue, hindsightTemplateBackupDatabaseValue, hindsightTemplateBackupInheritedValue,
  hindsightTemplateBackupObservationValue, HINDSIGHT_TEMPLATE_BACKUP_HASH_DOMAINS,
  HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES, HINDSIGHT_BACKUP_APPLY_MAX_BYTES, HINDSIGHT_BACKUP_PROOF_MAX_BYTES,
  HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES, HINDSIGHT_BACKUP_OBSERVATION_WRAPPER_MAX_BYTES,
  HINDSIGHT_BACKUP_OBSERVATION_REQUEST_MAX_BYTES } from "./hindsight-template-backup-encoding.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/hindsight-template-backup-v2.json", import.meta.url), "utf8"));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const request = HindsightBackupNativeRequestV2Schema.parse(fixture.request);
const schemas = {
  TakiBackupRequestV2: HindsightBackupNativeRequestV2Schema,
  TakiBackupProofV2: HindsightBackupNativeProofV2Schema,
  TemplateBackupBankProofV2: HindsightTemplateBackupBankProofV2Schema,
  TemplateBackupObservationResponse: HindsightTemplateBackupObservationResponseSchema,
};

describe("strict cross-language template backup-v2", () => {
  it("round-trips complete request, body, endpoint, archive, observation and copied-Core variants", () => {
    const pairs = [
      [HindsightBackupNativeRequestSchema, fixture.request], [HindsightBackupNativeProofSchema, fixture.proof],
      [HindsightBackupNativeProofBodyV2Schema, fixture.proofBody], [HindsightBackupNativeResponseV2Schema, fixture.nativeResponse],
      [HindsightBackupArchiveProofV2Schema, fixture.archiveProof], [HindsightBackupManifestV2Schema, fixture.manifest],
      [HindsightTemplateBackupObservationRequestSchema, fixture.observationRequest],
      [HindsightTemplateBackupObservationResponseSchema, fixture.observationResponse],
      [HindsightTemplateBackupAttestationSchema, fixture.attestation],
    ] as const;
    for (const [schema, value] of pairs) expect(schema.parse(value)).toEqual(value);
    expect(fixture.attestation.banks[0].selected.templateRevision).toBe("none");
    expect(HindsightTemplateBackupBankProofV2Schema.parse(fixture.unselectedBankProof).selected.state).toBe("unselected");
  });

  it("rejects the shared missing, extra, alias and wrong-version cases without downgrading", () => {
    for (const example of fixture.invalidCases) {
      const schema = schemas[example.component as keyof typeof schemas];
      expect(schema.safeParse(example.value).success, example.name).toBe(false);
    }
    expect(HindsightBackupNativeProofBodyV2Schema.safeParse(fixture.proof).success).toBe(false);
    expect(HindsightBackupArchiveProofSchema.safeParse({ ...fixture.archiveProof, version: 1 }).success).toBe(false);
    expect(HindsightBackupManifestSchema.safeParse({ ...fixture.manifest, version: 1 }).success).toBe(false);
    const selected = request.templates.find((bank) => bank.selected !== null)!;
    expect(HindsightBackupNativeRequestV2Schema.safeParse({ ...request, templates: request.templates.map((bank) =>
      bank !== selected ? bank : { ...bank, selected: { ...bank.selected, request: { ...bank.selected!.request,
        target: { ...bank.target, bank_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff" } } } }) }).success).toBe(false);
  });

  it("preserves historical v1 serialized bytes and never upgrades their meaning", () => {
    const old = { request: HindsightBackupNativeRequestSchema, proof: HindsightBackupNativeProofSchema,
      archive: HindsightBackupArchiveProofSchema, manifest: HindsightBackupManifestSchema };
    for (const [name, schema] of Object.entries(old)) {
      const raw: string = fixture.legacy[name];
      expect(JSON.stringify(schema.parse(JSON.parse(raw)))).toBe(raw);
    }
  });

  it("keeps receipt inventory mandatory for unselected Banks even when it is nonempty", () => {
    expect(HindsightTemplateBackupBankProofV2Schema.safeParse({ ...fixture.unselectedBankProof,
      receiptInventory: fixture.selectedBankProof.receiptInventory }).success).toBe(true);
    expect(HindsightTemplateBackupBankProofV2Schema.safeParse({ ...fixture.unselectedBankProof, receiptInventory: null }).success).toBe(false);
    expect(HindsightTemplateBackupFailureSchema.safeParse({ error: "template_backup_refused", reason: "configuration_changed" }).success).toBe(true);
    expect(HindsightTemplateBackupFailureSchema.safeParse({ error: "template_backup_refused", reason: "unknown" }).success).toBe(false);
  });
});

describe("complete backup commitments", () => {
  it("matches all published canonical bytes and digests, including both receipt inventory vectors", () => {
    for (const vector of fixture.vectors) {
      const canonical = hindsightTemplateBackupHashJson(vector.domain, vector.value);
      expect(canonical).toBe(vector.canonical);
      expect(sha(canonical)).toBe(vector.hash);
    }
    expect([...new Set(fixture.vectors.map((vector: { domain: string }) => vector.domain))].sort())
      .toEqual([...HINDSIGHT_TEMPLATE_BACKUP_HASH_DOMAINS].sort());
    expect(sha(hindsightTemplateBackupHashJson("request", hindsightTemplateBackupRequestValue(request)))).toBe(request.requestHash);
    expect(hindsightTemplateBackupRequestValue({ ...request, templates: [...request.templates].reverse(), nativeBankIds: [...request.nativeBankIds].reverse() }))
      .toEqual(hindsightTemplateBackupRequestValue(request));
  });

  it("retains original lifecycle request, snapshot, receipt and full definition hash domains", () => {
    const { request_hash, ...apply } = HindsightTemplateApplyRequestSchema.parse(fixture.original.apply);
    const { receipt_hash, ...receipt } = HindsightTemplateReceiptSchema.parse(fixture.original.receipt);
    const { snapshot_hash, ...before } = fixture.original.before;
    expect(sha(hindsightTemplateHashJson("request", apply))).toBe(request_hash);
    expect(sha(hindsightTemplateHashJson("receipt", receipt))).toBe(receipt_hash);
    expect(sha(hindsightTemplateHashJson("snapshot", before))).toBe(snapshot_hash);
    expect(sha(hindsightTemplateHashJson("definition", fixture.original.projection)))
      .toBe(fixture.selectedBankProof.selected.definitionProjectionHash);
    expect(hindsightTemplateBackupDatabaseValue(fixture.original.projection)).toEqual(fixture.vectors.find((value: { domain: string }) => value.domain === "database").value);
    expect(sha(hindsightTemplateBackupHashJson("inherited", hindsightTemplateBackupInheritedValue(fixture.original.projection))))
      .toBe(fixture.selectedBankProof.selected.inheritedConfigHash);
    const observation = fixture.selectedBankProof.selected.configurationObservation;
    expect(sha(hindsightTemplateBackupHashJson("observation", hindsightTemplateBackupObservationValue(fixture.original.apply.target, observation))))
      .toBe(observation.observationHash);
  });

  it("sorts complete receipt identities, rejects duplicates and binds the exact incarnation", () => {
    const { target, request_id, request_hash, receipt_hash } = fixture.original.receipt;
    const tuples = [{ request_id, request_hash, receipt_hash }, { request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", request_hash, receipt_hash }];
    expect(hindsightTemplateBackupReceiptsValue(target, [...tuples].reverse())).toEqual(hindsightTemplateBackupReceiptsValue(target, tuples));
    expect(() => hindsightTemplateBackupReceiptsValue(target, [tuples[0]!, tuples[0]!])).toThrow("HINDSIGHT_BACKUP_TEMPLATE_RECEIPTS_INVALID");
    const digest = (bank: typeof target) => sha(hindsightTemplateBackupHashJson("receipts", hindsightTemplateBackupReceiptsValue(bank, [])));
    expect(digest(target)).not.toBe(digest({ ...target, bank_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff" }));
  });
});

describe("backup byte budgets", () => {
  it("preserves the legal maximum plan and adds wrapper capacity without allocating a maximum-size payload", () => {
    const v1 = 4096 + 256 * (256 * 6 + 3) + 1_000_000 * (256 * 2 + 3);
    const v2 = v1 + 256 * (HINDSIGHT_BACKUP_APPLY_MAX_BYTES + 8192) + 65_536;
    expect(v2).toBe(651_778_496);
    expect(v2).toBeLessThan(HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES);
    const overhead = hindsightBackupJsonBytes(fixture.observationRequest) - hindsightBackupJsonBytes(fixture.request);
    expect(overhead).toBeLessThanOrEqual(HINDSIGHT_BACKUP_OBSERVATION_WRAPPER_MAX_BYTES);
    expect(HINDSIGHT_BACKUP_OBSERVATION_REQUEST_MAX_BYTES - HINDSIGHT_BACKUP_V2_REQUEST_MAX_BYTES)
      .toBe(HINDSIGHT_BACKUP_OBSERVATION_WRAPPER_MAX_BYTES);
  });

  it("rechecks each complete original Apply against the independent 512-KiB limit", () => {
    const value = structuredClone(request);
    const bank = value.templates.find((entry) => entry.selected !== null)!;
    const model = { name: "Model", source_query: "x".repeat(20_000), tags: [], max_tokens: 1024, trigger: null };
    bank.selected!.request.changes.models = Array.from({ length: 24 }, (_, index) => ({ kind: "upsert", definition: { ...model, id: "m-" + index } }));
    expect(HindsightBackupNativeRequestV2Schema.safeParse(value).success).toBe(true);
    bank.selected!.request.changes.models.push(...Array.from({ length: 4 }, (_, index) => ({ kind: "upsert" as const, definition: { ...model, id: "extra-" + index } })));
    expect(HindsightBackupNativeRequestV2Schema.safeParse(value).success).toBe(false);
  });

  it("keeps 256 Banks with maximal bounded metadata inside both proof and manifest budgets", () => {
    const proof = structuredClone(fixture.proof);
    const manifest = structuredClone(fixture.manifest);
    const schema = "界".repeat(120);
    proof.banks = []; proof.templates = []; manifest.banks = []; manifest.templates.banks = [];
    for (let index = 0; index < 256; index++) {
      const suffix = String(index).padStart(4, "0");
      const target = { ...fixture.selectedBankProof.target, bank_id: "界".repeat(252) + suffix };
      proof.banks.push({ ...fixture.proof.banks[0], bankId: target.bank_id, currentCursor: Number.MAX_SAFE_INTEGER });
      proof.templates.push({ ...fixture.selectedBankProof, target, selected: { ...fixture.selectedBankProof.selected,
        configurationObservation: { ...fixture.selectedBankProof.selected.configurationObservation, schema } } });
      const characterId = "c".repeat(156) + suffix;
      const bank = { ...fixture.manifest.banks[0], bankId: "character:" + characterId, nativeBankId: target.bank_id, scope: "character", characterId };
      manifest.banks.push(bank);
      manifest.templates.banks.push({ ...fixture.attestation.banks[0], target, canonicalIdentity: bank.bankId, scope: bank.scope, characterId });
    }
    manifest.native = { ...manifest.native, schema, proof };
    expect(HindsightBackupNativeProofV2Schema.safeParse(proof).success).toBe(true);
    expect(HindsightBackupManifestV2Schema.safeParse(manifest).success).toBe(true);
    expect(hindsightBackupJsonBytes(proof)).toBeLessThan(HINDSIGHT_BACKUP_PROOF_MAX_BYTES);
    expect(hindsightBackupJsonBytes({ ...fixture.observationResponse, schema,
      proof: Object.fromEntries(Object.entries(proof).filter(([key]) => !["zipSha256", "zipBytes"].includes(key))) })).toBeLessThan(HINDSIGHT_BACKUP_PROOF_MAX_BYTES);
    expect(hindsightBackupJsonBytes(manifest)).toBeLessThan(HINDSIGHT_BACKUP_MANIFEST_MAX_BYTES);
  });
});
