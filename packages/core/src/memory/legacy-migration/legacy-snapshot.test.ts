import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishLegacySnapshot } from "./legacy-snapshot.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function root(): string { const value = mkdtempSync(join(tmpdir(), "taki-migration-")); roots.push(value); return value; }

describe("legacy snapshot", () => {
  it("publishes complete sorted raw evidence atomically and reopens by snapshot id", () => {
    const workspace = root(); const destination = root();
    mkdirSync(join(workspace, "memory", "global", "profile"), { recursive: true });
    writeFileSync(join(workspace, "memory", "global", "profile", "a.md"), "raw\r\n");
    const result = publishLegacySnapshot({ workspaceRoot: workspace, destinationRoot: destination, now: "2026-08-20T00:00:00.000Z" });
    expect(result.directory).toBeTruthy(); expect(result.manifest.entries[0]?.relativePath).toBe("entries/global/profile/a.md");
    expect(readFileSync(join(result.directory as string, "entries/global/profile/a.md"), "utf8")).toBe("raw\r\n");
    const reopened = publishLegacySnapshot({ workspaceRoot: workspace, destinationRoot: destination, now: "different" });
    expect(reopened.manifest.snapshotId).toBe(result.manifest.snapshotId);
  });

  it("creates a new explicit migration destination before free-space preflight", () => {
    const workspace = root(); const parent = root(); const destination = join(parent, "workspace", "memory-migration");
    mkdirSync(join(workspace, "memory", "global", "profile"), { recursive: true });
    writeFileSync(join(workspace, "memory", "global", "profile", "a.md"), "raw");
    expect(existsSync(destination)).toBe(false);
    const result = publishLegacySnapshot({ workspaceRoot: workspace, destinationRoot: destination, now: "2026-08-20T00:00:00.000Z" });
    expect(existsSync(destination)).toBe(true); expect(result.directory).toContain(destination);
  });

  it("dry-run returns a report without creating a durable directory", () => {
    const workspace = root(); const destination = root();
    mkdirSync(join(workspace, "memory"), { recursive: true });
    const result = publishLegacySnapshot({ workspaceRoot: workspace, destinationRoot: destination, now: "2026-08-20T00:00:00.000Z", dryRun: true });
    expect(result.directory).toBeNull(); expect(result.temporary).toBe(true);
  });

  it("records links as exceptions and never dereferences them", () => {
    const workspace = root(); const destination = root();
    mkdirSync(join(workspace, "memory", "global"), { recursive: true });
    const outside = join(root(), "outside.md"); writeFileSync(outside, "secret");
    try { symlinkSync(outside, join(workspace, "memory", "global", "link.md")); } catch { return; }
    const result = publishLegacySnapshot({ workspaceRoot: workspace, destinationRoot: destination, now: "2026-08-20T00:00:00.000Z", dryRun: true });
    expect(result.manifest.entries[0]?.exception?.code).toBe("REPARSE_POINT");
  });
});
