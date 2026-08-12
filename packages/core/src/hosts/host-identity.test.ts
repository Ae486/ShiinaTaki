import { chmodSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateHostIdentity } from "./host-identity.ts";

const dirs: string[] = [];
function identityPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-host-id-"));
  dirs.push(dir);
  return join(dir, "host-identity.json");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { chmodSync(dir, 0o700); } catch { /* best-effort test cleanup */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadOrCreateHostIdentity", () => {
  it("creates once and survives restart without reminting", () => {
    const path = identityPath();
    const first = loadOrCreateHostIdentity(path, () => "11111111-1111-4111-8111-111111111111");
    const second = loadOrCreateHostIdentity(path, () => "22222222-2222-4222-8222-222222222222");
    expect(first).toBe(second);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hostId: first });
  });

  it("fails boot on malformed or invalid existing identity", () => {
    const path = identityPath();
    writeFileSync(path, "{bad");
    expect(() => loadOrCreateHostIdentity(path)).toThrow(/invalid JSON/);
    writeFileSync(path, JSON.stringify({ hostId: "not-a-uuid" }));
    expect(() => loadOrCreateHostIdentity(path)).toThrow(/malformed/);
  });

  it("loses a publication race without overwriting the winning identity", () => {
    const path = identityPath();
    const winner = "22222222-2222-4222-8222-222222222222";
    const result = loadOrCreateHostIdentity(path, () => "11111111-1111-4111-8111-111111111111", {
      link: (stagedPath, targetPath) => {
        writeFileSync(targetPath, JSON.stringify({ hostId: winner }));
        linkSync(stagedPath, targetPath);
      },
    });

    expect(result).toBe(winner);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hostId: winner });
    expect(readdirSync(dirname(path))).toEqual(["host-identity.json"]);
  });

  it("leaves no target or staged file when atomic publication fails", () => {
    const path = identityPath();
    const failure = Object.assign(new Error("publication denied"), { code: "EACCES" });

    expect(() => loadOrCreateHostIdentity(path, undefined, { link: () => { throw failure; } })).toThrow(
      "publication denied",
    );
    expect(readdirSync(dirname(path))).toEqual([]);
  });
});
