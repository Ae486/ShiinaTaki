/**
 * INPUT:  the numbered migration modules
 * OUTPUT: MIGRATIONS — the explicit, ordered list handed to openDatabase (no fs/glob discovery)
 * POS:    core/db/migrations — the single registry of migrations; append each new NNN module here in version order
 */
import type { Migration } from "../migration-runner.ts";
import { timelineMigration001 } from "./001-timeline.ts";
import { memoryMigration002 } from "./002-memory.ts";
import { memoryAutoStateMigration003 } from "./003-memory-auto-state.ts";

export const MIGRATIONS: Migration[] = [timelineMigration001, memoryMigration002, memoryAutoStateMigration003];
