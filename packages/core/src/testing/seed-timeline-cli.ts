/**
 * INPUT:  argv[2] = core data dir, argv[3] = JSON file path holding [{characterId, role, content}]
 * OUTPUT: rows appended to <dataDir>/taki.db through the real migrations + timeline repo; exits 0/1
 * POS:    core/testing — e2e pre-boot seeding CLI; runs BEFORE the core process so the single-writer
 *         invariant holds sequentially; never imported or run by production code
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";

const SeedEntriesSchema = z.array(
  z.object({
    characterId: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
  }),
);

const [dataDir, entriesFile] = process.argv.slice(2);
if (!dataDir || !entriesFile) {
  process.stderr.write("usage: seed-timeline-cli <dataDir> <entries.json>\n");
  process.exit(1);
}

const entries = SeedEntriesSchema.parse(JSON.parse(readFileSync(entriesFile, "utf8")));
const db = openDatabase({ path: join(dataDir, "taki.db"), migrations: MIGRATIONS });
const repo = createTimelineRepo(db);
for (const entry of entries) repo.append(entry);
db.close();
process.stdout.write(`seeded ${entries.length} timeline rows\n`);
