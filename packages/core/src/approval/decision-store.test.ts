import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createDecisionStore, type DecisionStore } from "./decision-store.ts";
import type { ApprovalOutcome } from "./approval-broker.ts";

const dirs: string[] = [];
function tmpPath(name = "mcp-approvals.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-approvals-"));
  dirs.push(dir);
  return join(dir, name);
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function store(filePath: string): DecisionStore {
  const { logger } = createCaptureLogger();
  return createDecisionStore({ filePath, logger });
}
const outcome = (approved: boolean, scope: ApprovalOutcome["scope"]): ApprovalOutcome => ({ approved, scope });

describe("createDecisionStore (T11/T13)", () => {
  it("remembers `always` so the ask is skipped, and persists across store instances", () => {
    const path = tmpPath();
    store(path).remember("files", "read", outcome(true, "always"));
    expect(store(path).get("files", "read")).toBe("always"); // survives a fresh instance (persisted)
  });

  it("maps deny+always to `never`", () => {
    const path = tmpPath();
    store(path).remember("files", "delete", outcome(false, "always"));
    expect(store(path).get("files", "delete")).toBe("never");
  });

  it("keeps `session` decisions in memory but not across instances", () => {
    const path = tmpPath();
    const s = store(path);
    s.remember("files", "read", outcome(true, "session"));
    expect(s.get("files", "read")).toBe("always"); // same instance -> remembered
    expect(store(path).get("files", "read")).toBeUndefined(); // new instance -> forgotten
  });

  it("does not remember `once`", () => {
    const path = tmpPath();
    const s = store(path);
    s.remember("files", "read", outcome(true, "once"));
    expect(s.get("files", "read")).toBeUndefined();
  });

  it("keys decisions per server+tool: one server's tool never unlocks another's", () => {
    const path = tmpPath();
    const s = store(path);
    s.remember("files", "read", outcome(true, "always"));
    expect(s.get("other", "read")).toBeUndefined();
    // Ambiguous name splits must not collide either (toolName is server-controlled).
    s.remember("a", "b c", outcome(true, "always"));
    expect(s.get("a b", "c")).toBeUndefined();
  });

  it("round-trips the persisted file shape", () => {
    const path = tmpPath();
    store(path).remember("files", "read", outcome(true, "always"));
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(onDisk.approvals[0]).toMatchObject({ serverName: "files", toolName: "read", decision: "always" });
    expect(typeof onDisk.approvals[0].decidedAt).toBe("string");
  });

  it("warns and starts empty on a malformed file (approvals are re-askable, not fatal)", () => {
    const path = tmpPath();
    writeFileSync(path, "{ broken");
    const { logger, records } = createCaptureLogger();
    const s = createDecisionStore({ filePath: path, logger });
    expect(s.get("files", "read")).toBeUndefined();
    expect(records.some((r) => r.level === "warn")).toBe(true);
  });
});
