import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";

describe("Hindsight Bank setup repo", () => {
  it("upserts one safe row per canonical Bank without template bodies", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const repo = createHindsightBankSetupRepo(db);
    const bank = { scope: "global" as const, canonicalIdentity: "global", externalBankId: "taki-v1-global-abc", templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status: "verified" as const, operationIds: [], lastVerifiedAt: "2026-08-21T00:00:00.000Z", lastError: null };
    repo.upsert(bank);
    expect(repo.get("global")).toEqual(bank);
    repo.markAllPending();
    expect(repo.get("global")).toMatchObject({ status: "pending", operationIds: [], lastVerifiedAt: null });
    expect(db.prepare("SELECT count(*) AS n FROM hindsight_bank_setup").get()?.n).toBe(1);
    db.close();
  });
});
