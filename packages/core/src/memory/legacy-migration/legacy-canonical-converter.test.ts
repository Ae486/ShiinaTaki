import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { canonicalMemoryMigration017 } from "../../db/migrations/017-canonical-memory.ts";
import { memoryLegacyMigration021 } from "../../db/migrations/021-memory-legacy-migration.ts";
import { normalizeLegacySource } from "./legacy-source-normalizer.ts";
import { convertLegacyBlock, convertLegacyEntry } from "./legacy-canonical-converter.ts";
import { createLegacyCanonicalImportRepo } from "./legacy-canonical-import-repo.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const now = "2026-08-20T00:00:00.000Z";
const rawEntry = (body: string, status = "active") => new TextEncoder().encode(`---\nid: arbitrary\nlayer: profile\nimportance: 8\ncreated: ${now}\nstatus: ${status}\n---\n${body}`);

function setup(): { db: Database; epoch: string; bank: string } {
  const db = openDatabase({ path: ":memory:", migrations: [canonicalMemoryMigration017, memoryLegacyMigration021] }); dbs.push(db);
  const authority = createCanonicalMemoryAuthorityRepo(db); const epoch = authority.initializeLocalAuthority(now).epochId;
  const bank = authority.createBank({ authorityEpochId: epoch, bankId: "bank-global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "memory", config: {} }).bankId;
  return { db, epoch, bank };
}

describe("migration canonical converter/importer", () => {
  it("maps lifecycle/policy/provenance and replays deterministic records", () => {
    const { db, epoch, bank } = setup(); const result = normalizeLegacySource("entries/global/profile/a.md", rawEntry("hello"));
    expect(result.ok).toBe(true); if (!result.ok) return;
    const converted = convertLegacyEntry({ source: result.source, epochId: epoch, bankId: bank });
    expect(converted.ok && converted.kind).toBe("record"); if (!converted.ok || converted.kind !== "record") return;
    expect(converted.record.policy.visibility).toBe("retrieved"); expect(converted.record.provenance.origin).toBe("legacy-import");
    const importer = createLegacyCanonicalImportRepo(db); expect(importer.importRecord(converted)).toBe("inserted"); expect(importer.importRecord(converted)).toBe("replayed");
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(1);
  });

  it("supports zero-result archived/empty conversion without manufacturing a unit", () => {
    const { db, epoch, bank } = setup(); const result = normalizeLegacySource("entries/global/profile/a.md", rawEntry("", "archived"));
    expect(result.ok).toBe(true); if (!result.ok) return;
    const converted = convertLegacyEntry({ source: result.source, epochId: epoch, bankId: bank });
    expect(converted.ok && converted.kind).toBe("zero"); if (!converted.ok || converted.kind !== "zero") return;
    const importer = createLegacyCanonicalImportRepo(db); expect(importer.importZero(converted)).toBe("inserted");
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(0);
  });

  it("keeps Blocks out of units and FTS and refuses conflicting destination content", () => {
    const { db } = setup(); const normalized = normalizeLegacySource("blocks/global/user-card.md", new TextEncoder().encode("User text"));
    expect(normalized.ok).toBe(true); if (!normalized.ok) return;
    const block = convertLegacyBlock(normalized.source, now); expect(block).not.toBeNull(); if (!block) return;
    const importer = createLegacyCanonicalImportRepo(db); expect(importer.importBlock(block)).toBe("inserted"); expect(importer.importBlock(block)).toBe("replayed");
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(0); expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0);
    expect(() => importer.importBlock({ ...block, content: "changed" })).toThrow("IMPORT_CONFLICT");
  });

  it("freezes default intention expiry from the recency anchor and preserves unknown metadata", () => {
    const { epoch, bank } = setup();
    const raw = new TextEncoder().encode(`---\nid: arbitrary\nlayer: intentions\nimportance: 8\ncreated: ${now}\nupdated: 2026-08-21T00:00:00.000Z\nstatus: active\ncustom_key: retained\n---\nfuture plan`);
    const result = normalizeLegacySource("entries/characters/taki/intentions/a.md", raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const converted = convertLegacyEntry({ source: result.source, epochId: epoch, bankId: bank, intentionsDefaultDays: 7 });
    expect(converted.ok && converted.kind).toBe("record");
    if (!converted.ok || converted.kind !== "record") return;
    expect(converted.record.policy.retention).toEqual({ kind: "expiring", expiresAt: "2026-08-28T00:00:00.000Z" });
    expect(converted.source.metadata.legacyMetadata).toEqual({ custom_key: "retained" });
  });
});
