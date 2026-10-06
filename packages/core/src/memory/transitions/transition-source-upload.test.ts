import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../testing/memory-transition-reentry-fixtures.ts";
import { readCanonicalSource, upsertCanonicalSource } from "../../db/canonical-memory-maintenance-records.ts";
import { captureTransitionLocal } from "../../db/memory-transition-local-capture.ts";
import { prepareTransitionDelta } from "../../db/memory-transition-delta-repo.ts";
import { readTransitionSourceUploads } from "../../db/memory-transition-source-upload.ts";
import { uploadTransitionSources } from "./transition-source-upload.ts";
import { hindsightApplicationHash } from "../hindsight/hindsight-application-integrity.ts";
import type { HindsightTransitionSourceClient } from "../hindsight/hindsight-transition-source-client.ts";

function setup(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); const fixture = createTransitionReentryFixture(db, { aliases: true });
  const alias = fixture.candidate.state.sourceAliases[0]!;
  const source = readCanonicalSource(db, { epochId: fixture.candidate.targetEpochId, bankId: alias.bankId, documentId: alias.documentId })!;
  db.transaction(() => upsertCanonicalSource(db, { ...source, retainedText: "源".repeat(100_000), revision: source.revision + 1 }, source.revision + 1));
  const capture = captureTransitionLocal(db, fixture.input);
  const prepared = prepareTransitionDelta(db, { ...fixture.input, captureId: capture.captureId, localBankId: alias.bankId,
    ...fixture.targets.find((row) => row.target.bank_id === "native-global")! });
  return { db, fixture, prepared, upload: readTransitionSourceUploads(db, prepared.transitionId)[0]!,
    input: { ...fixture.input, prepared, executor: prepared.request.executor, request: () => ({ timeoutMs: 10_000 }) } };
}
function uploader() {
  let sealed = false; let loseSealReply = true; const parts = new Map<number, string>();
  const client: HindsightTransitionSourceClient = {
    uploadTransitionSourceBody: vi.fn<HindsightTransitionSourceClient["uploadTransitionSourceBody"]>(async ({ bankId, request }) => ({ namespace: request.namespace, bank_id: bankId,
      descriptor: request.descriptor, state: sealed ? "sealed" : "uploading", received_parts: parts.size, expires_at: null })),
    putTransitionSourcePart: vi.fn(async ({ bankId, bodyId, partNumber, request }) => {
      const previous = parts.get(partNumber); if (previous && previous !== request.data_base64) throw new Error("different bytes");
      parts.set(partNumber, request.data_base64);
      const body = { namespace: request.namespace, bank_id: bankId, body_id: bodyId, part_number: partNumber,
        part_sha256: request.part_sha256, total_bytes: Buffer.from(request.data_base64, "base64").byteLength };
      return { ...body, part_hash: hindsightApplicationHash({ namespace: request.namespace, bankId, domain: "part", value: body }) };
    }),
    sealTransitionSourceBody: vi.fn(async ({ request }) => {
      sealed = true; if (loseSealReply) { loseSealReply = false; throw new Error("lost seal reply"); } return request.descriptor;
    }),
  };
  return { client, parts };
}
describe("W3 durable Source upload replay", () => {
  it("recovers a lost seal reply across SQLite reopen with identical body/part IDs and one immutable attempt", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "w3-source-upload-")), "candidate.sqlite");
    const test = setup(path); const native = uploader();
    try {
      await expect(uploadTransitionSources(test.db, { ...test.input, client: native.client })).rejects.toThrow("lost seal reply");
      expect(native.parts.size).toBe(test.upload.ref.total_parts);
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_source_upload_attempts").get()?.n).toBe(1);
      test.db.close(); const reopened = openDatabase({ path, migrations: MIGRATIONS });
      try {
        const before = native.parts.size;
        await uploadTransitionSources(reopened, { ...test.input, client: native.client });
        expect(native.client.putTransitionSourcePart).toHaveBeenCalledTimes(before);
        expect(native.client.sealTransitionSourceBody).toHaveBeenCalledTimes(1);
        expect(readTransitionSourceUploads(reopened, test.prepared.transitionId)).toEqual([test.upload]);
        expect(reopened.prepare("SELECT count(*) AS n FROM memory_transition_source_upload_attempts").get()?.n).toBe(1);
      } finally { reopened.close(); }
    } finally { try { test.db.close(); } catch { /* Reopen test already closed the original handle. */ } }
  });
  it("refuses missing upload capabilities and stale configuration before sending any Source bytes", async () => {
    const test = setup(); const native = uploader();
    try {
      await expect(uploadTransitionSources(test.db, { ...test.input, client: {} })).rejects.toThrow("SOURCE_EVIDENCE_UNAVAILABLE");
      await expect(uploadTransitionSources(test.db, { ...test.input, client: native.client,
        assertConfiguration: () => { throw new Error("configuration changed"); } })).rejects.toThrow("configuration changed");
      expect(native.client.uploadTransitionSourceBody).not.toHaveBeenCalled();
      expect(test.db.prepare("SELECT count(*) AS n FROM memory_transition_source_upload_attempts").get()?.n).toBe(0);
    } finally { test.db.close(); }
  });
  it("rechecks the Core owner after prepare and refuses before a part if configuration changes mid-upload", async () => {
    const test = setup(); const native = uploader(); let guards = 0;
    try {
      await expect(uploadTransitionSources(test.db, { ...test.input, client: native.client,
        assertConfiguration: () => { if (++guards === 4) throw new Error("owner changed"); } })).rejects.toThrow("owner changed");
      expect(native.client.uploadTransitionSourceBody).toHaveBeenCalledTimes(1);
      expect(native.client.putTransitionSourcePart).not.toHaveBeenCalled();
    } finally { test.db.close(); }
  });
});
