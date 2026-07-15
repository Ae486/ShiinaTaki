import { describe, expect, it } from "vitest";
import { safeMemberPath } from "./member-path.ts";

describe("safeMemberPath (the single-sourced traversal guard)", () => {
  it("normalizes clean relative names to POSIX form", () => {
    expect(safeMemberPath("casual/model.json")).toBe("casual/model.json");
    expect(safeMemberPath("casual/data/model.moc")).toBe("casual/data/model.moc");
    expect(safeMemberPath("./casual/./x.png")).toBe("casual/x.png"); // strips . segments
    expect(safeMemberPath("a\\b\\c.png")).toBe("a/b/c.png"); // folds backslashes
    expect(safeMemberPath("casual//data///t.png")).toBe("casual/data/t.png"); // collapses empty segments
  });

  it("rejects every traversal / absolute / device / NUL vector", () => {
    for (const bad of [
      "",
      "../escape",
      "casual/../../etc/passwd",
      "a/b/../../../c",
      "/absolute/x",
      "\\\\server\\share\\x", // UNC
      "C:/Windows/system32",
      "C:\\Windows",
      "C:foo", // drive-relative
      "data:text/plain", // colon (drive / ADS)
      "x:zone", // NTFS alternate data stream
      "with\0null",
      "..",
      "./",
      ".",
      "CON",
      "nul.png",
      "dir/COM1",
      "CLOCK$", // console/clock devices have no extension form
      "CONIN$",
    ]) {
      expect(safeMemberPath(bad)).toBeNull();
    }
  });

  it("rejects trailing-dot/space segments that Windows would rewrite on write (fail-closed superset)", () => {
    // Win32 strips trailing dots/spaces per component, so each of these diverges from what actually lands on disk:
    // `.. ` → `..` (a parent hop the confine() path.relative check would NOT catch), `NUL ` → the NUL device,
    // `foo.png ` → a colliding name. No legitimate Cubism member carries a trailing dot/space.
    for (const bad of [
      ".. /.. /evil.txt", // dot-dot-space traversal that path.resolve treats as literal
      "casual/.. /x.png",
      "foo.png ",
      "foo.png.",
      "NUL ",
      "NUL.",
      "COM1 ",
      "a/NUL /b",
      ". ",
      "...",
    ]) {
      expect(safeMemberPath(bad)).toBeNull();
    }
  });
});
