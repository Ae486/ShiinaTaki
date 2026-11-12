// Read-only replay of actual measured primary requests through the production projection.
// Candidate selection is restricted to each historical dispatch; recorded facts are never replaced.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequestAttributionRepo } from "../../../../packages/core/src/db/request-attribution-repo.ts";
import { ContextRequestMeasuredPayloadSchema } from "../../../../packages/shared/src/request-attribution-schema.ts";

const path = process.argv[process.argv.indexOf("--db") + 1];
assert.ok(process.argv.includes("--db") && path, "Pass --db with the verified runtime SQLite path");
const raw = new DatabaseSync(path, { readOnly: true });
raw.exec("PRAGMA query_only=ON");
raw.exec("BEGIN");
let cutoff;
const db = {
  prepare(sql) {
    if (cutoff && sql.startsWith("SELECT s.original_user_seq,s.run_id")) {
      sql = sql.replace("ORDER BY s.original_user_seq", `AND s.original_user_seq<=${cutoff.inputSeq} ORDER BY s.original_user_seq`);
    }
    if (cutoff && sql.includes("ORDER BY dispatch_seq DESC LIMIT 2")) {
      sql = sql.replace("ORDER BY dispatch_seq DESC", `AND e.effect_id IN (
        SELECT json_extract(payload_json,'$.effectId') FROM run_events
        WHERE run_id=e.run_id AND kind='effect.intent_committed' AND seq<=${cutoff.dispatchSeq}) ORDER BY dispatch_seq DESC`);
    }
    return raw.prepare(sql);
  },
  transaction: (operation) => operation(),
};

try {
  const repo = createRequestAttributionRepo(db);
  const latest = repo.read("taki");
  assert.ok(latest.request?.composition, `Latest request unavailable: ${latest.reason}`);
  const rows = raw.prepare(`SELECT m.payload_json,
    (SELECT MAX(i.seq) FROM run_events i WHERE i.run_id=m.run_id AND i.kind='effect.intent_committed'
      AND json_extract(i.payload_json,'$.effectId')=json_extract(m.payload_json,'$.effectId')) AS dispatch_seq,
    u.quality,u.input_tokens,u.model_id
    FROM run_events m LEFT JOIN run_usage u ON u.effect_id=json_extract(m.payload_json,'$.effectId')
    WHERE m.kind='context.request.measured' AND json_extract(m.payload_json,'$.population')='primary'
    ORDER BY m.occurred_at`).all();
  const result = { capturedPrimaryRequests: rows.length, readable: 0, reported: 0, responseNamesDiffer: 0,
    usageMissing: 0, partialOrigins: 0 };
  for (const row of rows) {
    const measured = ContextRequestMeasuredPayloadSchema.parse(JSON.parse(row.payload_json));
    assert.ok(Number.isSafeInteger(measured.primaryInputSeq) && Number.isSafeInteger(row.dispatch_seq));
    cutoff = { inputSeq: measured.primaryInputSeq, dispatchSeq: row.dispatch_seq };
    const snapshot = repo.read("taki");
    assert.ok(snapshot.request, `Historical request unavailable: ${snapshot.reason}`);
    assert.equal(snapshot.request.effectId, measured.effectId);
    assert.deepEqual(snapshot.request.composition, measured.composition);
    assert.equal(snapshot.request.modelId, measured.modelId);
    assert.equal(snapshot.request.responseModelId, row.model_id);
    result.readable++;
    if (row.quality === "reported" && row.input_tokens !== null) {
      assert.equal(snapshot.request.inputTokens, row.input_tokens);
      result.reported++;
    } else {
      assert.equal(snapshot.request.inputTokens, null);
      result.usageMissing++;
    }
    if (row.model_id !== null && row.model_id !== measured.modelId) result.responseNamesDiffer++;
    if (measured.composition.coverage.status === "partial") result.partialOrigins++;
  }
  console.log(JSON.stringify({ passed: true, readOnly: true, paidCalls: 0, historicalSelectionOnly: true, ...result,
    latest: { status: latest.status, reason: latest.reason, requestedModel: latest.request.modelId,
      responseModel: latest.request.responseModelId, inputTokens: latest.request.inputTokens,
      effectiveWindow: latest.request.window?.effectiveRealTokens,
      compositionUnits: latest.request.composition.totalUnits, coverage: latest.request.composition.coverage } }, null, 2));
} finally {
  raw.exec("ROLLBACK");
  raw.close();
}
