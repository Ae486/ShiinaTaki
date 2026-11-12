/**
 * INPUT: an owned journey's Core database, original retain receipt and disposable PG port
 * OUTPUT: immutable parent/child identities and read-only Native effect evidence
 * POS: first-use harness only; never admits, retries or completes a write
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRetainWrite } from "./memory-tool-evidence.mjs";

export function pendingWriteEvidence(ctx, run) {
  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
  try {
    assert.equal(run.memoryEffect.authorityEpochId, ctx.epochId, "original retain belongs to another authority");
    const { parentRow, parent, childRow, child } = readRetainWrite(db, run.memoryEffect);
    return {
      identity: { parent: { ...parent.identity.key, sequence: parent.sequence, intentHash: parent.intentHash,
        nativeOperationId: parent.nativeOperationId, namespace: parent.identity.namespace },
      child: { sequence: childRow.sequence, operationId: child.intent.operationId, intentHash: child.intentHash,
        remoteOperationId: child.remoteOperationId, createdAt: child.createdAt, originalAt: child.intent.originalAt,
        providerLineageId: child.intent.providerLineageId, bankGeneration: child.intent.bankGeneration } },
      parentState: parentRow.state, childPhase: child.phase, diagnosticCode: child.diagnosticCode,
      documentId: child.documentId, content: parent.identity.operation.request.content,
    };
  } finally { db.close(); }
}

export function nativeWriteEvidence(ctx, write) {
  const script = fileURLToPath(new URL("./native-write-evidence.py", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = execFile("H:/hindsight/.venv/Scripts/python.exe", ["-B", script],
      { windowsHide: true, timeout: 30_000, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (error, stdout, stderr) => {
        if (error) { reject(new Error(`Native write observation failed: ${stderr || error.message}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (cause) { reject(cause); }
      });
    child.stdin.end(JSON.stringify({ pgPort: ctx.pg.port, bankId: write.identity.parent.bankId,
      operationId: write.identity.child.remoteOperationId, content: write.content }));
  });
}
