import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { finalizeConsumerCompletion, requireConsumerIdentity, requireUncompletedConsumer } from "./current-cutover-real-data-completion.ts";
import { OWNED_RUN_ID } from "./current-cutover-real-data-state.ts";

function withDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "taki-d78-completion-"));
  try { run(directory); }
  finally {
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
}

test("consumer IDs are explicit safe filename components", () => {
  assert.equal(requireConsumerIdentity("real-run-3"), "real-run-3");
  for (const value of [undefined, "", "../other", "a/b", "a\\b", "with space", "with.dot", "中文", "x".repeat(233)]) {
    assert.throws(() => requireConsumerIdentity(value), /REAL_DATA_CONSUMER_ID_REFUSED/);
  }
});

test("completion is atomically published after the final audit with exactly the supervisor's four fields", () => {
  withDirectory((directory) => {
    const target = { directory, consumerId: "real-run-3" };
    const path = requireUncompletedConsumer(target);
    const phases: string[] = [];
    finalizeConsumerCompletion({ succeeded: true, target, audit: () => {
      assert.equal(existsSync(path), false);
      phases.push("audit");
    }, cleanup: () => { assert.equal(existsSync(path), false); phases.push("cleanup"); },
    announce: () => assert.deepEqual(phases, ["audit", "cleanup"]) });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { schemaVersion: 1, runDirectoryId: OWNED_RUN_ID,
      consumerId: "real-run-3", state: "complete" });
    assert.deepEqual(readdirSync(directory), ["consumer-real-run-3-complete.json"]);
    assert.throws(() => requireUncompletedConsumer(target), /REAL_DATA_CONSUMER_ALREADY_COMPLETE/);
  });
});

test("failed execution still audits sources but cannot publish a completion receipt", () => {
  withDirectory((directory) => {
    const target = { directory, consumerId: "failed-run" };
    let audits = 0;
    finalizeConsumerCompletion({ succeeded: false, target, audit: () => { audits++; },
      cleanup: () => undefined,
      announce: () => assert.fail("failed execution must not announce completion") });
    assert.equal(audits, 1);
    assert.deepEqual(readdirSync(directory), []);
  });
});

test("source-audit, resource-cleanup and final announcement failures cannot publish completion", () => {
  for (const phase of ["audit", "cleanup", "announce"] as const) withDirectory((directory) => {
    const target = { directory, consumerId: "failed-finalization" };
    let cleanupCalls = 0;
    assert.throws(() => finalizeConsumerCompletion({ succeeded: true, target,
      audit: () => { if (phase === "audit") throw new Error("audit refused"); },
      cleanup: () => { cleanupCalls++; if (phase === "cleanup") throw new Error("cleanup refused"); },
      announce: () => { throw new Error("announcement refused"); } }), /refused/);
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(readdirSync(directory), []);
  });
});

test("preflight finalization requires no consumer identity and writes no completion file", () => {
  withDirectory((directory) => {
    let audits = 0;
    finalizeConsumerCompletion({ succeeded: true, target: null, audit: () => { audits++; }, cleanup: () => undefined,
      announce: () => undefined });
    assert.equal(audits, 1);
    assert.deepEqual(readdirSync(directory), []);
  });
});

test("a completion file that appears after admission is preserved without overwrite", () => {
  withDirectory((directory) => {
    const target = { directory, consumerId: "racing-run" };
    const path = requireUncompletedConsumer(target);
    assert.throws(() => finalizeConsumerCompletion({ succeeded: true, target, audit: () => undefined, cleanup: () => undefined,
      announce: () => writeFileSync(path, "existing evidence", "utf8") }), /REAL_DATA_CONSUMER_ALREADY_COMPLETE/);
    assert.equal(readFileSync(path, "utf8"), "existing evidence");
    assert.deepEqual(readdirSync(directory), ["consumer-racing-run-complete.json"]);
  });
});

test("every nonzero or nonnumeric terminal exit refuses completion even after successful work and cleanup", () => {
  for (const exitCode of [1, 2, -1, 130, "0", "failed", Number.NaN, null]) withDirectory((directory) => {
    const target = { directory, consumerId: "failed-exit" };
    let cleanupCalls = 0;
    finalizeConsumerCompletion({ succeeded: true, exitCode, target, audit: () => undefined, cleanup: () => { cleanupCalls++; },
      announce: () => assert.fail("a failed process must not announce success") });
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(readdirSync(directory), []);
  });
});

test("an explicit zero exit publishes only after successful cleanup", () => {
  withDirectory((directory) => {
    const target = { directory, consumerId: "zero-exit" };
    let cleaned = false;
    finalizeConsumerCompletion({ succeeded: true, exitCode: 0, target, audit: () => undefined,
      cleanup: () => { cleaned = true; }, announce: () => assert.equal(cleaned, true) });
    assert.equal(existsSync(join(directory, "consumer-zero-exit-complete.json")), true);
  });
});
