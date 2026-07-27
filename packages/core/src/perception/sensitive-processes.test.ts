import { describe, expect, it } from "vitest";
import {
  BUILTIN_SENSITIVE_PROCESSES,
  createSensitiveProcessCheck,
  normalizeProcessName,
} from "./sensitive-processes.ts";

describe("normalizeProcessName", () => {
  it("case-folds, trims, collapses whitespace and drops a trailing .exe", () => {
    expect(normalizeProcessName("  1Password.EXE ")).toBe("1password");
    expect(normalizeProcessName("Remote   Desktop\tConnection")).toBe("remote desktop connection");
  });

  it("degrades an absent name to the empty key", () => {
    expect(normalizeProcessName(null)).toBe("");
    expect(normalizeProcessName(undefined)).toBe("");
    expect(normalizeProcessName("   ")).toBe("");
  });
});

describe("createSensitiveProcessCheck", () => {
  const isSensitive = createSensitiveProcessCheck();

  it("matches a built-in under either reported form (FileDescription or exe name)", () => {
    // The Shell reports xcap's app_name (FileDescription) first and the exe name only as a fallback, so both must hit.
    expect(isSensitive("1Password")).toBe(true);
    expect(isSensitive("1password.exe")).toBe(true);
    expect(isSensitive("mstsc.exe")).toBe(true);
    expect(isSensitive("Remote Desktop Connection")).toBe(true);
  });

  it("does not match ordinary apps", () => {
    for (const name of ["Code.exe", "Visual Studio Code", "chrome.exe", "explorer.exe"]) {
      expect(isSensitive(name)).toBe(false);
    }
  });

  it("never matches an absent or blank process name", () => {
    expect(isSensitive(null)).toBe(false);
    expect(isSensitive(undefined)).toBe(false);
    expect(isSensitive("")).toBe(false);
    expect(isSensitive("   ")).toBe(false);
  });

  it("matches exactly, never by substring — a short entry cannot blind the sampler to unrelated apps", () => {
    const check = createSensitiveProcessCheck({ extra: ["bank"] });
    expect(check("bank.exe")).toBe(true);
    expect(check("bankruptcy-notes.exe")).toBe(false);
    expect(check("MyBank Online")).toBe(false);
  });

  it("adds the operator-supplied extras alongside the built-ins, normalized the same way", () => {
    const check = createSensitiveProcessCheck({ extra: ["KeePassXC.exe", "  Bitwarden  "] });
    expect(check("keepassxc")).toBe(true);
    expect(check("bitwarden.exe")).toBe(true);
    expect(check("1Password")).toBe(true); // built-ins survive the merge
  });

  it("keeps the built-in list to the entries a comparable names explicitly", () => {
    // Guard for the ra §OMITTED ruling: exact membership is unsourced curation, so nothing may be invented here —
    // extra entries belong in the user-editable list (#26), not baked in.
    expect([...BUILTIN_SENSITIVE_PROCESSES]).toEqual(["1password", "mstsc", "remote desktop connection"]);
  });
});
