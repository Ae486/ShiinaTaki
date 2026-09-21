/**
 * INPUT:  a deterministic clock, an isolated file-backed SQLite on the full migration lineage and synthetic Legacy files
 * OUTPUT: createLegacyMigrationFixture() -> { db, workspace, runner, write, previewId, prepare, activate, ... } + cleanup
 * POS:    core/memory/legacy-migration — test-only harness shared by the B2 producer tests; never imported by production code
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MemoryMigrationActivation, MemoryMigrationStatus } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createLegacyMigrationRunner, type LegacyMigrationRunner, type PrepareInput, type RunnerDeps } from "./legacy-migration-runner.ts";
import { createMemoryAuthorityFence, type MemoryAuthorityFence } from "./memory-authority-fence.ts";

export const FIXTURE_NOW = "2026-08-20T00:00:00.000Z";
export const PROFILE_ENTRY = "memory/global/profile/entry.md";
export const GLOBAL_BLOCK = "blocks/global/user-card.md";

export interface LegacyMigrationFixture {
  db: Database;
  dbPath: string;
  dataDir: string;
  workspace: string;
  destination: string;
  fence: MemoryAuthorityFence;
  runner: LegacyMigrationRunner;
  clock: { now: string };
  write(relativePath: string, content: string): void;
  previewId(): string;
  prepare(input?: Partial<PrepareInput>): Promise<MemoryMigrationStatus>;
  activate(runId: string): Promise<MemoryMigrationActivation>;
}

const open: LegacyMigrationFixture[] = [];

/** Call from afterEach: closes databases before removing the temp directories. */
export function cleanupLegacyMigrationFixtures(): void {
  for (const fixture of open.splice(0)) {
    fixture.db.close();
    rmTempDir(fixture.dataDir);
  }
}

export function legacyEntry(content: string, overrides: Partial<Record<"id" | "layer" | "importance" | "status", string>> = {}): string {
  const meta = { id: "arbitrary", layer: "profile", importance: "8", status: "active", ...overrides };
  return `---\nid: ${meta.id}\nlayer: ${meta.layer}\nimportance: ${meta.importance}\ncreated: ${FIXTURE_NOW}\nstatus: ${meta.status}\n---\nremembered ${content}`;
}

export function createLegacyMigrationFixture(input: { entries?: Record<string, string>; deps?: Partial<RunnerDeps> } = {}): LegacyMigrationFixture {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-legacy-migration-"));
  const dbPath = join(dataDir, "state.db");
  const db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  const workspace = join(dataDir, "workspace");
  const destination = join(workspace, "memory-migration");
  const clock = { now: FIXTURE_NOW };
  const fence = input.deps?.fence ?? createMemoryAuthorityFence();
  const runner = createLegacyMigrationRunner({ db, destinationRoot: destination, fence, now: () => clock.now, ...input.deps });
  const write = (relativePath: string, content: string): void => {
    const path = join(workspace, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  for (const [relativePath, content] of Object.entries(input.entries ?? { [PROFILE_ENTRY]: legacyEntry("profile") })) write(relativePath, content);
  const fixture: LegacyMigrationFixture = {
    db, dbPath, dataDir, workspace, destination, fence, runner, clock, write,
    previewId: () => runner.dryRun(workspace).reportId,
    prepare: (overrides = {}) => runner.prepare({ runId: "run-1", workspaceRoot: workspace, previewId: fixture.previewId(), owner: "test", ...overrides }),
    activate: (runId) => runner.activate({ runId, workspaceRoot: workspace, timeoutMs: 1_000, transactionId: `tx-${runId}`, owner: "test" }),
  };
  open.push(fixture);
  return fixture;
}
