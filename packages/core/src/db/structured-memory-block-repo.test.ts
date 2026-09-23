import { describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import { getBlock } from "../memory/block-registry.ts";

describe("structured Memory Blocks", () => {
  it("CAS-creates an absent block and refuses a stale absent snapshot without replacing its content", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const repo = createStructuredMemoryBlockRepo(db);
    const scope = { kind: "global" as const, characterId: null };
    try {
      const created = repo.replace({ blockId: "user-model", scope, content: "first", actor: "background", expectedRevision: 0 });
      expect(created.revision).toBe(1);
      expect(() => repo.replace({ blockId: "user-model", scope, content: "stale overwrite", actor: "background", expectedRevision: 0 }))
        .toThrow("MEMORY_REVISION_MISMATCH");
      expect(repo.read("user-model", scope)?.content).toBe("first");
    } finally { db.close(); }
  });
  it("enforces writer policy and revisioned whole-document replacement", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createStructuredMemoryBlockRepo(db);
    expect(() => repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, content: "x", actor: "background" })).toThrow(/writer/);
    const first = repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, content: "x", actor: "user", now: "2026-08-19T00:00:00.000Z" });
    expect(first.revision).toBe(1); expect(repo.read("user-card", { kind: "global", characterId: null })?.content).toBe("x");
    expect(() => repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, content: "y", expectedRevision: 9, actor: "user" })).toThrow(/REVISION/); db.close();
  });
  it("renders registry headers in order, budgets content, and never enters canonical facts", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createStructuredMemoryBlockRepo(db);
    repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, content: "user truth", actor: "user" });
    repo.replace({ blockId: "user-model", scope: { kind: "global", characterId: null }, content: "pattern ".repeat(2_000), actor: "background" });
    repo.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "taki" }, content: "ramen", actor: "background" });
    const rendered = repo.render([{ kind: "global", characterId: null }, { kind: "character", characterId: "taki" }]);
    const headers = ["user-card", "user-model", "memory-index"].map((id) => getBlock(id)!.header);
    expect(headers.map((header) => rendered.indexOf(header))).toEqual([...headers.map((header) => rendered.indexOf(header))].sort((a, b) => a - b));
    expect(rendered).toContain("[truncated to block budget]"); expect(rendered).toContain("[budget:");
    expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(0); expect(db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(0); db.close();
  });
  it("binds a canonical writer's Block write to the active authority epoch inside the transaction", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const repo = createStructuredMemoryBlockRepo(db);
    const scope = { kind: "global" as const, characterId: null };
    const epoch = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority("2026-09-23T00:00:00.000Z").epochId;
    expect(repo.replace({ blockId: "user-model", scope, content: "same epoch", actor: "background", expectedEpochId: epoch }).revision).toBe(1);
    expect(() => repo.replace({ blockId: "user-model", scope, content: "retired epoch", actor: "background", expectedEpochId: "closed-epoch" })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(repo.read("user-model", scope)).toMatchObject({ content: "same epoch", revision: 1 }); db.close();
  });
});
