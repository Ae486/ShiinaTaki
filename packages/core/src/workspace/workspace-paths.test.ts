import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "./workspace-paths.ts";

// A real Workspace root on disk (realpath'd) plus a sibling "outside" dir the escapes try to reach.
const base = realpathSync(mkdtempSync(join(tmpdir(), "taki-ws-")));
const root = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(root, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, "secret.txt"), "top secret");
mkdirSync(join(root, "notes"), { recursive: true });
writeFileSync(join(root, "notes", "todo.md"), "buy milk");

const paths = createWorkspacePaths({ root });

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("workspace path confinement — escape rejection (T8, AC4)", () => {
  // Each row is a path the model might supply and the exact reason it must be refused.
  const escapes: Array<[string, string, "INVALID_PATH" | "OUTSIDE_WORKSPACE"]> = [
    ["parent traversal", "../secret.txt", "INVALID_PATH"],
    ["deep traversal", "../../Windows/System32", "INVALID_PATH"],
    ["mixed traversal", "a/../../b", "INVALID_PATH"],
    ["windows absolute", "C:\\Windows\\system.ini", "INVALID_PATH"],
    ["drive-relative", "C:foo", "INVALID_PATH"],
    ["posix absolute", "/etc/passwd", "INVALID_PATH"],
    ["unc path", "\\\\server\\share\\x", "INVALID_PATH"],
    ["ntfs ADS", "notes:hidden", "INVALID_PATH"],
    ["reserved NUL", "NUL", "INVALID_PATH"],
    ["reserved COM1 with ext", "COM1.txt", "INVALID_PATH"],
    ["embedded NUL byte (fs throws pre-IO)", "foo\0bar", "INVALID_PATH"],
    ["empty", "", "INVALID_PATH"],
  ];

  for (const [label, input, code] of escapes) {
    it(`rejects ${label} (${code})`, () => {
      expect(paths.resolve(input)).toEqual({ ok: false, code });
    });
  }

  it("rejects a symlink that escapes the Workspace (realpath resolves it → OUTSIDE_WORKSPACE)", () => {
    // A directory junction inside the Workspace pointing OUT — realpath must see through it (lexical checks would not).
    const link = join(root, "evil");
    symlinkSync(outside, link, "junction");
    expect(paths.resolve("evil/secret.txt")).toEqual({ ok: false, code: "OUTSIDE_WORKSPACE" });
    expect(paths.resolve("evil")).toEqual({ ok: false, code: "OUTSIDE_WORKSPACE" });
  });
});

describe("workspace path confinement — accepted paths", () => {
  it("accepts an existing nested file and echoes a relative path", () => {
    const r = paths.resolve("notes/todo.md");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.relative).toBe(join("notes", "todo.md"));
      expect(r.real).toBe(join(root, "notes", "todo.md"));
    }
  });

  it("accepts a not-yet-existing nested target (a write creates its parents)", () => {
    const r = paths.resolve("a/b/c.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.real).toBe(join(root, "a", "b", "c.txt"));
  });

  it("accepts the root itself as '.'", () => {
    expect(paths.resolve(".")).toEqual({ ok: true, real: root, relative: "." });
  });
});

describe("workspace path confinement — authority-owned prefixes", () => {
  it("rejects exact protected roots and every descendant", () => {
    const protectedPaths = createWorkspacePaths({ root, forbiddenPrefixes: ["memory", "blocks", "memory-migration"] });
    expect(protectedPaths.resolve("memory")).toEqual({ ok: false, code: "OUTSIDE_WORKSPACE" });
    expect(protectedPaths.resolve("blocks/global/user-card.md")).toEqual({ ok: false, code: "OUTSIDE_WORKSPACE" });
    expect(protectedPaths.resolve("memory-migration/snapshot/manifest.json")).toEqual({ ok: false, code: "OUTSIDE_WORKSPACE" });
    expect(protectedPaths.resolve("memory-notes/todo.md").ok).toBe(true);
  });
});
