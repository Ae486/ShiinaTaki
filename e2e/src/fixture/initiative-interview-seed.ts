/**
 * INPUT: an isolated, initialized canonical Local database before its Core process starts
 * OUTPUT: one genuine recallable Character Memory record with an unknown-outcome interview and private probe
 * POS: e2e/fixture — owning repository writes only before startup; no Blocks, Timeline or live-database mutation
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_DIR } from "./paths.ts";

export interface SeededInterviewMemory {
  memoryId: string; documentId: string; bankId: string; marker: string; text: string;
}

/** Call seedCanonicalLocal(dataDir) first, and call this only while no Core owns the database. */
export function seedInitiativeInterviewMemory(dataDir: string, marker = `interview-probe-${randomUUID()}`): SeededInterviewMemory {
  const seed = { memoryId: `interview-memory-${randomUUID()}`, documentId: `interview-source-${randomUUID()}`,
    bankId: "e2e-character", marker,
    text: `The user reported an interview for a research role. The interview outcome is unknown. Recall-only reference: ${marker}.` };
  const moduleUrl = (file: string) => pathToFileURL(join(CORE_DIR, "src", "db", file)).href;
  const script = `
    const { createHash } = await import("node:crypto");
    const { openDatabase } = await import(${JSON.stringify(moduleUrl("sqlite.ts"))});
    const { MIGRATIONS } = await import(${JSON.stringify(moduleUrl("migrations/index-list.ts"))});
    const { createCanonicalMemoryAuthorityRepo } = await import(${JSON.stringify(moduleUrl("canonical-memory-authority-repo.ts"))});
    const { createCanonicalMemoryRepo, stableRequestHash } = await import(${JSON.stringify(moduleUrl("canonical-memory-repo.ts"))});
    const db = openDatabase({ path: process.argv[1], migrations: MIGRATIONS });
    try {
      const seed = JSON.parse(process.argv[2]);
      const epochId = createCanonicalMemoryAuthorityRepo(db).activeEpoch().epochId;
      const now = new Date().toISOString();
      const provenance = { actor: "user", origin: "explicit-user", characterId: "taki",
        timelineFromSeq: null, timelineToSeq: null, capturedAt: now, sanitized: true, sourceRef: "operator-retained-interview" };
      const source = { authorityEpochId: epochId, bankId: seed.bankId, documentId: seed.documentId,
        contentHash: createHash("sha256").update(seed.text).digest("hex"), retainedText: seed.text, context: null,
        tags: [], metadata: {}, observationScopes: null, provenance, revision: 1, createdAt: now, updatedAt: now };
      const unit = { authorityEpochId: epochId, bankId: seed.bankId, memoryId: seed.memoryId, documentId: seed.documentId,
        chunkId: null, text: seed.text, context: null, factType: "experience", state: "valid", revision: 1,
        tags: ["taki-layer:episodes"], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null,
        eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: now, createdAt: now, updatedAt: now,
        editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
      const policy = { authorityEpochId: epochId, bankId: seed.bankId, memoryId: seed.memoryId, layerId: "episodes",
        importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
        retention: { kind: "permanent" }, policyVersion: 1, updatedAt: now };
      const result = createCanonicalMemoryRepo(db).retain({ epochId, bankId: seed.bankId,
        requestId: "seed-" + seed.memoryId, requestHash: stableRequestHash(seed), source, unit, policy,
        searchTerms: "interview research role outcome unknown follow up check in" });
      if (result.memories[0]?.memoryId !== seed.memoryId) throw new Error("interview seed was not retained");
    } finally { db.close(); }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dataDir, "taki.db"), JSON.stringify(seed)], {
    cwd: join(CORE_DIR, "..", ".."), stdio: "pipe",
  });
  return seed;
}
