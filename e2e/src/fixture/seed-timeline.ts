/**
 * INPUT:  the core data dir (BEFORE the core process boots) + seed rows [{role, content}]
 * OUTPUT: seedTimeline(coreDataDir, rows) — creates <dataDir>/taki.db via core's seed-timeline-cli
 *         (real migrations + repo, no hand-copied DDL) and appends the rows for character "taki"
 * POS:    e2e/fixture — pre-boot timeline pollution for the hallucination L2; sequential single-writer
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_DIR } from "./paths.ts";

export interface SeedRow {
  role: "user" | "assistant";
  content: string;
}

export function seedTimeline(coreDataDir: string, rows: SeedRow[]): void {
  const file = join(coreDataDir, "seed-timeline.json");
  writeFileSync(file, JSON.stringify(rows.map((row) => ({ characterId: "taki", ...row }))));
  // Throws (with the CLI's stderr) on a non-zero exit — a failed seed must fail the boot, never run unseeded.
  execFileSync(process.execPath, [join("src", "testing", "seed-timeline-cli.ts"), coreDataDir, file], {
    cwd: CORE_DIR,
    stdio: ["ignore", "ignore", "pipe"],
  });
}
