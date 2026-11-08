/**
 * INPUT: the copied-instance replay's actual Core loader and authenticated operator
 * OUTPUT: task-only admitted-work timing, exact backup refusal and public retry after observed drain
 * POS: diagnostic harness; preserves production fences, deadlines, outcomes and original source data
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as shared from "../../../../../packages/shared/src/index.ts";

const TAG = "backup-quiescence-probe";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function installQuiescenceProbe({ observeMaintenance = false } = {}) {
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith("/canonical-local-write-fence.ts")) return loaded;
    let source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const replace = (old, next, count = 1) => {
      assert.equal(source.split(old).length - 1, count, "quiescence probe anchor changed");
      source = source.replaceAll(old, next);
    };
    replace("export function createCanonicalLocalWriteFence", "let fenceProbeSequence = 0;\nexport function createCanonicalLocalWriteFence");
    replace("  let fenced = false;", [
      `  const probeId = ++fenceProbeSequence; let workSequence = 0; let probing = ${observeMaintenance}; const work = new Map();`,
      "  const origin = new Error().stack?.split('\\n').filter((line) => line.trimStart().startsWith('at '));",
      "  const observe = (event) => { const value = { diagnostic: '" + TAG + "', event, fenceId: probeId, at: Date.now(), origin,",
      "    active: [...work].map(([id, value]) => ({ id, ageMs: Date.now() - value.at, frames: value.frames })) };",
      observeMaintenance ? "    globalThis.__takiMaintenanceFence?.(value); };" : "    console.error(JSON.stringify(value)); };",
      "  let fenced = false;",
    ].join("\n"));
    replace("const owner = { live: true };", [
      "const owner = { live: true }; const workId = ++workSequence;",
      "      work.set(workId, { at: Date.now(), frames: new Error().stack?.split('\\n').filter((line) => line.trimStart().startsWith('at ')) });",
      "      if (probing) observe('admitted');",
    ].join("\n"), 2);
    replace("owner.live = false; leave();", "owner.live = false; work.delete(workId); if (probing) observe('settled'); leave();", 2);
    replace("      fenced = true;\n      try { await drain(() => active, waiters, input); }",
      "      fenced = true; probing = true; observe('quiesce');\n      try { await drain(() => active, waiters, input); observe('drained'); }");
    replace("catch (error) { fenced = retired || input.keepFencedOnFailure === true; throw error; }",
      "catch (error) { observe('refused'); fenced = retired || input.keepFencedOnFailure === true; throw error; }");
    return { ...loaded, source };
  } });
}

function observations(core) {
  return core.log().split(/\r?\n/).filter((line) => line.startsWith('{"diagnostic":"' + TAG + '"')).map((line) => JSON.parse(line));
}

async function operation(operator, request) {
  const start = Date.now();
  const admitted = shared.MemoryOperationSubmitResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.submit, { request })).operation;
  const phases = [];
  for (const deadline = start + 600_000; Date.now() < deadline; await sleep(250)) {
    const value = shared.MemoryOperationStatusResultSchema.parse(await operator.call(shared.MEMORY_OPERATION_METHODS.status,
      { operationId: admitted.operationId })).operation;
    if (value.producer?.phase !== phases.at(-1)) phases.push(value.producer?.phase);
    if (["completed", "failed", "cancelled", "outcome_unknown"].includes(value.state)) {
      return { operationId: value.operationId, state: value.state, errorCode: value.errorCode,
        result: value.result, producer: value.producer, phases, totalMs: Date.now() - start };
    }
  }
  throw new Error("backup probe operation observation deadline");
}

export async function probeBackupAfterRecall(input) {
  const { operator, core, epochId, observed } = input;
  const request = { kind: "backup.capture", expectedEpochId: epochId, route: "native-endpoint" };
  observed.attempts = [await operation(operator, request)];
  console.log(JSON.stringify({ boundary: "backup-first-attempt", ...observed.attempts[0] }));
  if (!input.firstAttemptOnly && observed.attempts[0].errorCode === "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT") {
    const start = observations(core).findLast((event) => event.event === "quiesce");
    assert(start, "a quiescence refusal must include its actual admitted owners");
    observed.blocked = start;
    let drained;
    for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(250)) {
      const current = observations(core).findLast((event) => event.fenceId === start.fenceId && event.at >= start.at);
      if (current?.active.length === 0) { drained = current; break; }
    }
    assert(drained, "the original admitted work did not settle after backup released its fence");
    observed.drained = drained;
    observed.attempts.push(await operation(operator, request));
  }
  const captured = observed.attempts.at(-1);
  assert.equal(captured.state, "completed", "backup capture did not complete");
  observed.verification = await operation(operator, { kind: "backup.verify", backupId: captured.result.backupId });
  assert.equal(observed.verification.state, "completed", "captured pair did not verify");
  observed.fenceEvents = observations(core);
}
