import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, openReadonlyDatabase } from "../../db/sqlite.ts";
import * as sqlite from "../../db/sqlite.ts";
import * as migrations from "../../db/migration-runner.ts";
import { candidateFixture, digest, writeCandidateZip, binaryCopy } from "./hindsight-candidate-fixtures.ts";
import { admitHindsightCandidateArchive } from "./hindsight-candidate-admission.ts";
import { readCandidateArchive } from "./hindsight-candidate-archive.ts";
import { readCandidateCore } from "./hindsight-candidate-core.ts";
import { HINDSIGHT_CANDIDATE_TABLES } from "./hindsight-candidate-profile.ts";

describe("D1-A complete historical inventory", () => {
  it("refuses a newer controlling-Core schema until an explicit archive profile admits it", async () => {
    const f = await candidateFixture("selected", 60);
    try {
      const before = readFileSync(f.corePath);
      await expect(admitHindsightCandidateArchive(f)).rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "core" } });
      expect(readFileSync(f.corePath)).toEqual(before);
    } finally { await f.close(); }
  }, 30_000);

  it.each(["selected", "removed"] as const)("reads nonempty %s template and Pending copies with no writer or source effects", async (scenario) => {
    const f = await candidateFixture(scenario);
    try {
      const files = readdirSync(f.directory); const bytes = readFileSync(f.corePath);
      const marker = f.h.joint.fixture.db.prepare("SELECT * FROM memory_authority_selection").all();
      const pending = f.h.joint.fixture.db.prepare("SELECT * FROM pending_memory").all();
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("no network during immutable inspection"); });
      const writer = vi.spyOn(sqlite, "openDatabase"); const migrate = vi.spyOn(migrations, "runMigrations");
      let result;
      try {
        result = await admitHindsightCandidateArchive(f);
        expect(writer).not.toHaveBeenCalled(); expect(migrate).not.toHaveBeenCalled();
      } finally { fetch.mockRestore(); writer.mockRestore(); migrate.mockRestore(); }
      expect(result.inventory.tables).toHaveLength(61);
      expect(new Set(result.inventory.tables.map((table) => table.family)).size).toBe(7);
      expect(result.inventory.tables.every((table) => table.rows === 2)).toBe(true);
      expect(result.inventory.bodies).toEqual({ referenced: 2, stored: 2 });
      expect(result.inventory.banks.every((bank) => bank.bodies > 0 && bank.artifacts > 0)).toBe(true);
      expect(result.inventory.banks.reduce((count, bank) => count + bank.pending.pendingCount, 0)).toBe(1);
      expect(result.inventory.core.tables.find((table) => table.name === "hindsight_template_selections")?.rows).toBeGreaterThan(0);
      expect(result.inventory.core.tables.find((table) => table.name === "hindsight_template_users")?.rows).toBeGreaterThan(0);
      expect(f.manifest.native.proof.banks[0]!.currentCursor).toBeGreaterThan(f.manifest.banks[0]!.core.replicaCursor!);
      expect(readFileSync(f.corePath)).toEqual(bytes); expect(readdirSync(f.directory)).toEqual(files);
      expect(f.h.joint.fixture.db.prepare("SELECT * FROM memory_authority_selection").all()).toEqual(marker);
      expect(f.h.joint.fixture.db.prepare("SELECT * FROM pending_memory").all()).toEqual(pending);
      const copy = openReadonlyDatabase(f.corePath);
      try {
        expect(copy.prepare("SELECT * FROM pending_memory").all()).toEqual(pending);
        expect(() => copy.exec("CREATE TABLE forbidden_writer(x)")).toThrow();
      } finally { copy.close(); }
    } finally { await f.close(); }
  }, 30_000);

  it("refuses every omitted required family/table, dropped column, unknown table, build, type and version", async () => {
    const f = await candidateFixture();
    try {
      for (const name of HINDSIGHT_CANDIDATE_TABLES.keys()) {
        const native = structuredClone(f.native); delete native.tables[name];
        native.taki!.entries = native.taki!.entries.filter((entry) => entry.name !== `${name}.bin`);
        const streams = { ...f.streams }; delete streams[name];
        writeCandidateZip(f.archivePath, native, streams);
        await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "omitted_required_data", subject: "table", name } });
      }
      const native = structuredClone(f.native); native.tables.documents!.columns.pop();
      writeCandidateZip(f.archivePath, native, f.streams);
      await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "omitted_required_data", subject: "column" } });
      writeCandidateZip(f.archivePath, f.native, f.streams);
      for (const key of ["compatibilityBuild", "upstreamCommit", "alembicRevision"] as const) {
        await expect(readCandidateArchive(f.archivePath, { ...f.targetSchema, [key]: "wrong-exact-version" }))
          .rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "schema" } });
      }
      const target = structuredClone(f.targetSchema); target.tables.find((table) => table.name === "memory_units")!.columns[1]!.typeName = "vector(4)";
      await expect(readCandidateArchive(f.archivePath, target)).rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "column" } });
      target.tables.push({ name: "extension_without_owned_archive", columns: [{ name: "id", typeName: "uuid" }] });
      target.tables.find((table) => table.name === "memory_units")!.columns[1]!.typeName = "vector(3)";
      await expect(readCandidateArchive(f.archivePath, target)).rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "table" } });
      await expect(readCandidateCore(f.corePath, { ...f.manifest, core: { ...f.manifest.core, migrationHead: 60 } }))
        .rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "core" } });
    } finally { await f.close(); }
  }, 30_000);

  it("detects altered counts/digests, absent file bytes, unresolved keys and NULL SQL bodies", async () => {
    const f = await candidateFixture();
    try {
      const changed = structuredClone(f.native); changed.tables.async_operations!.rows += 1;
      writeCandidateZip(f.archivePath, changed, f.streams);
      await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "tampered", subject: "table" } });
      const corrupt = { ...f.streams, async_operations: Buffer.from(f.streams.async_operations!) };
      corrupt.async_operations[25] = corrupt.async_operations[25]! ^ 1;
      writeCandidateZip(f.archivePath, f.native, corrupt);
      await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "tampered" } });
      for (const data of [binaryCopy([]), binaryCopy([[Buffer.from("file-1"), null], [Buffer.from("file-2"), null]]),
        binaryCopy([[Buffer.from("foreign-1"), Buffer.from("body")], [Buffer.from("foreign-2"), Buffer.from("body")]])]) {
        const native = structuredClone(f.native); native.tables.file_storage!.rows = data.length === 21 ? 0 : 2;
        native.tables.file_storage!.size_bytes = data.length;
        const entry = native.taki!.entries.find((entry) => entry.name === "file_storage.bin")!;
        entry.sha256 = digest(data); entry.bytes = data.length;
        writeCandidateZip(f.archivePath, native, { ...f.streams, file_storage: data });
        await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { subject: expect.stringMatching(/body|archive/) } });
      }
      await expect(readCandidateArchive(join(f.directory, "absent.zip"), f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "absent", subject: "archive" } });
      writeFileSync(f.archivePath, "truncated archive");
      await expect(readCandidateArchive(f.archivePath, f.targetSchema)).rejects.toMatchObject({ refusal: { reason: "tampered" } });
    } finally { await f.close(); }
  }, 30_000);

  it("refuses live WAL, changed whole-file bytes and a copy missing a body while preserving failed evidence", async () => {
    const f = await candidateFixture();
    try {
      await expect(readCandidateCore(join(f.h.joint.fixture.base.dataDir, "memory.sqlite"), f.manifest))
        .rejects.toMatchObject({ refusal: { reason: "unsupported", subject: "core", name: "live_sidecar" } });
      const changed = join(f.directory, "changed.sqlite"); copyFileSync(f.corePath, changed);
      const db = openDatabase({ path: changed, migrations: [] });
      try {
        // Deliberate corruption of this disposable copy, bypassing the writer's FK protection to test read-back.
        db.exec("PRAGMA foreign_keys=OFF"); db.exec("DELETE FROM hindsight_application_replica_bodies");
      } finally { db.close(); }
      await expect(readCandidateCore(changed, f.manifest)).rejects.toMatchObject({ refusal: { reason: "tampered", subject: "core" } });
      const bytes = readFileSync(changed); const manifest = structuredClone(f.manifest);
      manifest.core.sha256 = digest(bytes); manifest.core.bytes = bytes.length;
      await expect(readCandidateCore(changed, manifest)).rejects.toMatchObject({ refusal: { reason: "tampered", subject: "core" } });
      const omitted = structuredClone(f.manifest); omitted.banks.pop();
      await expect(readCandidateCore(f.corePath, omitted)).rejects.toMatchObject({ refusal: { reason: "tampered" } });
    } finally { await f.close(); }
  }, 30_000);

  it("binds direct admission to its original paths and schema across asynchronous archive reads", async () => {
    const f = await candidateFixture();
    try {
      const input = { corePath: f.corePath, archivePath: f.archivePath, manifest: structuredClone(f.manifest),
        targetSchema: structuredClone(f.targetSchema) };
      const reading = admitHindsightCandidateArchive(input);
      input.corePath = join(f.directory, "caller-replaced-core.sqlite");
      input.archivePath = join(f.directory, "caller-replaced-native.zip");
      input.targetSchema.tables.pop();
      input.manifest.backupId = "11111111-1111-4111-8111-111111111111";
      const result = await reading;
      expect(result.inventory.backupId).toBe(f.manifest.backupId);
      expect(result.inventory.tables).toHaveLength(61);
      expect(result.inventory.core.sha256).toBe(f.manifest.core.sha256);
    } finally { await f.close(); }
  }, 30_000);
});
