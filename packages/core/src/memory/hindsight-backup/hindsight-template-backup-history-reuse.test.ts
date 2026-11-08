import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hindsightTemplateBackupReceiptsValue } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { templateBackupConsumerFixture } from "../../testing/hindsight-template-backup-consumer-fixture.ts";
import { TemplateBankIdentitySchema, type TemplateBankIdentity } from "../hindsight/template-lifecycle/template-overlay-schema.ts";
import { readTemplatePlan, readTemplatePublication } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { templateIdentityKey } from "../hindsight/template-lifecycle/template-store-documents.ts";
import { readHindsightTemplateComponents } from "./hindsight-template-backup-attestation.ts";
import { readHindsightTemplateBackupExecution } from "./hindsight-template-backup-execution.ts";
import { readHindsightTemplateBackupDefaults, readHindsightTemplateBackupHistory,
  type HindsightTemplateBackupHistory } from "./hindsight-template-backup-history.ts";
import { hindsightBackupHash } from "./hindsight-template-backup-integrity.ts";
import { assertHindsightTemplatePublicationIdentity } from "./hindsight-template-backup-publication.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0)) await close();
});

async function harness(scenario: "selected" | "removed" = "selected") {
  const h = await templateBackupConsumerFixture(scenario);
  closers.unshift(h.close);
  const db = h.joint.fixture.db;
  const identities = db.prepare("SELECT identity_json FROM hindsight_template_enrollments ORDER BY canonical_identity")
    .all().map((row) => TemplateBankIdentitySchema.parse(JSON.parse(String(row.identity_json))));
  return { db, input: { epochId: "epoch", providerLineageId: identities[0]!.target.provider_lineage, identities } };
}

function countCompleteHistoryReads(db: Database) {
  const counts = new Map<string, number>();
  const prepare = db.prepare.bind(db);
  // This enumeration occurs once in the real complete reader, independently of
  // the selection count or its internal before-image reconstruction queries.
  vi.spyOn(db, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql !== "SELECT revision FROM hindsight_template_bases WHERE identity_key=:key ORDER BY revision") return statement;
    return { ...statement, all: (params) => {
      const key = String(params?.key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return statement.all(params);
    } };
  });
  return counts;
}

function expectOneReadPerIdentity(counts: Map<string, number>, identities: TemplateBankIdentity[]) {
  const actual = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const expected = identities.map((identity) => [templateIdentityKey(identity), 1] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  expect(actual, "complete history enumeration counts: " + JSON.stringify(actual)).toEqual(expected);
}

function expectCompleteCommitments(state: ReturnType<typeof readHindsightTemplateComponents>, histories: HindsightTemplateBackupHistory[]) {
  const receipts = histories.flatMap((history) => history.selections.map((selection) => selection.receipt));
  expect(state.receipts.map((receipt) => receipt.request_id).sort()).toEqual(receipts.map((receipt) => receipt.request_id).sort());
  expect(state.operationIds).toEqual(receipts.map((receipt) => "template-receipt:" + receipt.request_id).sort());
  expect(state.templates).toHaveLength(histories.length);
  expect(state.body.banks).toHaveLength(histories.length);
  for (const history of histories) {
    const bank = state.body.banks.find((value) => value.canonicalIdentity === history.identity.canonicalIdentity)!;
    const tuples = history.selections.map(({ receipt }) => ({ request_id: receipt.request_id,
      request_hash: receipt.request_hash, receipt_hash: receipt.receipt_hash }));
    expect(bank).toMatchObject({ target: history.identity.target, historyHash: history.historyHash,
      receiptInventory: { count: tuples.length,
        digest: hindsightBackupHash("receipts", hindsightTemplateBackupReceiptsValue(history.identity.target, tuples)) } });
    expect(bank.selected).toMatchObject({ selectionRevision: history.selected!.revision,
      templateRevision: history.selected!.templateRevision, requestHash: history.selected!.request.request_hash,
      receiptHash: history.selected!.receipt.receipt_hash });
    expect(state.templates.find((value) => value.target.bank_id === history.identity.target.bank_id)).toEqual({
      target: history.identity.target,
      selected: { request: history.selected!.request, receiptHash: history.selected!.receipt.receipt_hash },
    });
  }
}

function corruptHistoricalUser(db: Database, identity: TemplateBankIdentity) {
  db.exec("DROP TRIGGER hindsight_template_users_immutable_update");
  db.prepare("UPDATE hindsight_template_users SET document_hash=:hash WHERE identity_key=:key AND revision=0")
    .run({ hash: "f".repeat(64), key: templateIdentityKey(identity) });
}

describe("invocation-local complete template history reuse", () => {
  it.each(["selected", "removed"] as const)("verifies %s commitments once per identity, then rereads on the next call", async (scenario) => {
    const { db, input } = await harness(scenario);
    const histories = input.identities.map((identity) => readHindsightTemplateBackupHistory(db, identity));
    expect(histories.find((history) => history.identity.scope === "character")!.selections)
      .toHaveLength(scenario === "removed" ? 3 : 2);
    const defaultsHash = readHindsightTemplateBackupDefaults(db, input.providerLineageId).defaultsHash;
    const hold = readHindsightTemplateBackupExecution(db, { epochId: input.epochId, histories }).hold;
    const counts = countCompleteHistoryReads(db);
    const first = readHindsightTemplateComponents(db, input);
    expectCompleteCommitments(first, histories);
    expect(first.body).toMatchObject({ defaultsHash, hold });
    expectOneReadPerIdentity(counts, input.identities);
    counts.clear();
    expect(readHindsightTemplateComponents(db, input)).toEqual(first);
    expectOneReadPerIdentity(counts, input.identities);
  }, 30_000);

  it("validates out-of-input Character history without expanding Global targets or relevant plans", async () => {
    const { db, input } = await harness("removed");
    const global = input.identities.find((identity) => identity.scope === "global")!;
    const history = readHindsightTemplateBackupHistory(db, global);
    const hold = readHindsightTemplateBackupExecution(db, { epochId: input.epochId, histories: [history] }).hold;
    const defaultsHash = readHindsightTemplateBackupDefaults(db, input.providerLineageId).defaultsHash;
    const counts = countCompleteHistoryReads(db);
    const state = readHindsightTemplateComponents(db, { ...input, identities: [global] });
    expectCompleteCommitments(state, [history]);
    expect(state.body).toMatchObject({ defaultsHash, hold });
    expectOneReadPerIdentity(counts, input.identities);
  }, 30_000);

  it("keeps a new incarnation separate from the old Character history needed by publications/defaults", async () => {
    const { db, input } = await harness("removed");
    const character = input.identities.find((identity) => identity.scope === "character")!;
    const global = input.identities.find((identity) => identity.scope === "global")!;
    const replacement = { ...character, target: { ...character.target, bank_generation: randomUUID() } };
    const counts = countCompleteHistoryReads(db);
    const state = readHindsightTemplateComponents(db, { ...input, identities: [global, replacement] });
    expect(state.body.banks).toHaveLength(2);
    expect(state.body.banks.find((bank) => bank.scope === "character")).toMatchObject({
      target: replacement.target, selected: null, receiptInventory: { count: 0 },
    });
    expect(state.templates.find((bank) => bank.target.bank_id === character.target.bank_id))
      .toEqual({ target: replacement.target, selected: null });
    expect(state.receipts.every((receipt) => receipt.target.bank_id === global.target.bank_id)).toBe(true);
    expectOneReadPerIdentity(counts, [...input.identities, replacement]);
  }, 30_000);

  it("refuses corrupt old Character history even when only Global is requested after a warm call", async () => {
    const { db, input } = await harness("removed");
    const globalInput = { ...input, identities: input.identities.filter((identity) => identity.scope === "global") };
    const histories = input.identities.map((identity) => readHindsightTemplateBackupHistory(db, identity));
    const plan = readTemplatePlan(db, String(db.prepare("SELECT plan_id FROM hindsight_template_plans ORDER BY plan_id LIMIT 1").get()!.plan_id));
    const publication = readTemplatePublication(db, plan.planId)!;
    readHindsightTemplateComponents(db, globalInput);
    corruptHistoricalUser(db, input.identities.find((identity) => identity.scope === "character")!);
    expect(() => readHindsightTemplateComponents(db, globalInput)).toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(() => readHindsightTemplateBackupDefaults(db, input.providerLineageId)).toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(() => readHindsightTemplateBackupExecution(db, { epochId: input.epochId, histories })).toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(() => assertHindsightTemplatePublicationIdentity(db, { plan, publication })).toThrow("HINDSIGHT_RESPONSE_INVALID");
  }, 30_000);

  it.each(["applied pointer", "defaults pointer", "hold", "historical document"] as const)(
    "refuses changed %s on the next call rather than retaining verified history", async (mutation) => {
      const { db, input } = await harness("removed");
      readHindsightTemplateComponents(db, input);
      const character = input.identities.find((identity) => identity.scope === "character")!;
      if (mutation === "applied pointer") {
        db.exec("DROP TRIGGER hindsight_template_applied_step");
        db.prepare("UPDATE hindsight_template_applied SET revision=1 WHERE identity_key=:key")
          .run({ key: templateIdentityKey(character) });
      } else if (mutation === "defaults pointer") {
        db.exec("DROP TRIGGER hindsight_template_defaults_no_delete");
        db.prepare("DELETE FROM hindsight_template_defaults WHERE provider_lineage=:lineage").run({ lineage: input.providerLineageId });
      } else if (mutation === "hold") {
        db.exec("DROP TRIGGER hindsight_template_hold_step");
        db.exec(`UPDATE hindsight_template_holds SET state='active', publication_id=NULL
          WHERE plan_id=(SELECT plan_id FROM hindsight_template_plans ORDER BY plan_id LIMIT 1)`);
      } else corruptHistoricalUser(db, character);
      expect(() => readHindsightTemplateComponents(db, input)).toThrow();
    }, 30_000);

  it("owns a nested synchronous read transaction and discards partial histories after failure", async () => {
    const { db, input } = await harness("removed");
    const warm = readHindsightTemplateComponents(db, input);
    const character = input.identities.find((identity) => identity.scope === "character")!;
    db.exec("CREATE TEMP TABLE template_backup_reader_probe (value TEXT NOT NULL)");
    const boundaries = vi.spyOn(db, "transaction");
    const rollback = new Error("rollback isolated corruption");
    db.transaction(() => {
      db.prepare("INSERT INTO template_backup_reader_probe VALUES ('before')").run();
      expect(readHindsightTemplateComponents(db, input)).toEqual(warm);
      expect(() => db.transaction(() => {
        corruptHistoricalUser(db, character);
        expect(() => readHindsightTemplateComponents(db, input)).toThrow("HINDSIGHT_RESPONSE_INVALID");
        throw rollback;
      })).toThrow(rollback);
      expect(readHindsightTemplateComponents(db, input)).toEqual(warm);
      db.prepare("INSERT INTO template_backup_reader_probe VALUES ('after')").run();
    });
    expect(db.prepare("SELECT value FROM template_backup_reader_probe ORDER BY rowid").all())
      .toEqual([{ value: "before" }, { value: "after" }]);
    // One outer boundary, one fixture rollback, and one boundary for each of the
    // three component reads, including the failed read's nested savepoint.
    expect(boundaries).toHaveBeenCalledTimes(5);
    boundaries.mockRestore();
    expect(readHindsightTemplateComponents(db, input)).toEqual(warm);
  }, 30_000);
});
