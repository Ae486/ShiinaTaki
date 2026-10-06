/** Task-only crash-safe checkpoint. SQLite/native receipts remain the effect authority. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const same = (a, b) => assert.deepEqual(a, b);

export function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.next`;
  const fd = openSync(temporary, "wx");
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
  // Both names are in the same owned directory. Never truncate the last verified checkpoint.
  renameSync(temporary, path);
}

export function decodeCheckpoint(path) {
  const envelope = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(envelope.version, 1, "W5_CHECKPOINT_VERSION");
  assert(Number.isSafeInteger(envelope.sequence) && envelope.sequence > 0, "W5_CHECKPOINT_SEQUENCE");
  assert.equal(sha256(envelope.payloadJson), envelope.sha256, "W5_CHECKPOINT_HASH");
  const state = JSON.parse(envelope.payloadJson);
  assert(state && typeof state === "object" && !Array.isArray(state), "W5_CHECKPOINT_STATE");
  assert(state.steps && typeof state.steps === "object" && !Array.isArray(state.steps), "W5_CHECKPOINT_STEPS");
  assert(state.journey?.version === 1 && Array.isArray(state.journey.submissions), "W5_CHECKPOINT_JOURNEY");
  return { state, envelope };
}

export function openJourneyCheckpoint(path, legacyPath) {
  let sequence = 0;
  let state;
  let legacyBytes;
  if (existsSync(path)) {
    const loaded = decodeCheckpoint(path); sequence = loaded.envelope.sequence; state = loaded.state;
  } else {
    // Migration is deliberately narrow: a missing/corrupt historical result cannot create a new RETURN.
    assert(existsSync(legacyPath), "W5_RETAINED_RETURN_EVIDENCE_REQUIRED");
    legacyBytes = readFileSync(legacyPath);
    state = JSON.parse(legacyBytes.toString("utf8"));
    assert(state.returnCompleted && state.steps?.return?.operationId && state.steps.return.transitionId,
      "W5_RETAINED_RETURN_EVIDENCE_REQUIRED");
    assert(!state.journey, "W5_CHECKPOINT_MISSING_WITH_NEW_FORMAT_RESULT");
    state.journey = { version: 1, returnAnchor: null, localMutation: null, submissions: [] };
  }
  const history = join(dirname(path), "journey-checkpoint-history");
  const save = () => {
    mkdirSync(history, { recursive: true });
    if (legacyBytes) {
      const retainedLegacy = join(history, `legacy-driver-result-${sha256(legacyBytes)}.json`);
      if (!existsSync(retainedLegacy)) {
        const fd = openSync(retainedLegacy, "wx");
        try { writeFileSync(fd, legacyBytes); fsyncSync(fd); } finally { closeSync(fd); }
      }
      same(readFileSync(retainedLegacy), legacyBytes);
    }
    // Validate current state before writing; retained checkpoints are evidence, never an automatic fallback.
    assert(state.journey?.version === 1 && Array.isArray(state.journey.submissions));
    const payloadJson = JSON.stringify(state);
    const envelope = { version: 1, sequence: sequence + 1, payloadJson, sha256: sha256(payloadJson) };
    const retained = join(history, `${envelope.sequence}-${envelope.sha256}.json`);
    if (!existsSync(retained)) atomicJson(retained, envelope);
    atomicJson(path, envelope);
    sequence = envelope.sequence;
    same(decodeCheckpoint(path).state, state);
  };
  return { state, save };
}
