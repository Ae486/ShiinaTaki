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
      "data:text/plain", // colon (drive / ADS)
      "with\0null",
      "..",
      "./",
      ".",
      "CON",
      "nul.png",
      "dir/COM1",
    ]) {
      expect(safeMemberPath(bad)).toBeNull();
    }
  });
});
