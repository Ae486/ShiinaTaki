/** Real Core fixture import/construction/preview/shutdown; Native and runtime delegates remain synthetic. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { templateLifecycleFixture } from "../../../../packages/core/src/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createHindsightBackupStore } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-store.ts";

const fixture = templateLifecycleFixture();
try {
  const store = createHindsightBackupStore(fixture.base.dataDir);
  assert.equal(store.listSync().length, 0);
  const preview = await fixture.service.preview(fixture.params());
  assert.equal(preview.state, "ready");
  assert.equal(fixture.native.receipts.size, 0);
  assert.equal(fixture.db.prepare("SELECT count(*) AS count FROM hindsight_template_plans").get().count, 0);
  process.stdout.write(JSON.stringify({ state: "ready", preview: preview.state, nativeWrites: 0,
    runtimeBoundary: "synthetic delegates; real Core preview, operation owner and artifact store",
    sources: ["packages/core/src/memory/hindsight-backup/hindsight-backup-store.ts",
      "packages/core/src/memory/hindsight-backup/hindsight-backup-staging.ts",
      "packages/core/src/memory/hindsight-backup/hindsight-backup-pair.ts",
      "packages/core/src/memory/hindsight-backup/hindsight-template-backup-pair.ts",
      "packages/core/src/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts",
      "packages/shared/src/index.ts"].map((path) => ({ path,
        sha256: createHash("sha256").update(readFileSync(new URL("../../../../" + path, import.meta.url))).digest("hex") })) }) + "\n");
} finally {
  await fixture.close();
}
process.stdout.write("Core fixture and its unique operation owner closed.\n");
