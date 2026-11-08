import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { candidateFile, candidateDigest } from "./hindsight-candidate-files.ts";

vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof fs>() }));

describe("candidate file failure distinctions", () => {
  it("reports actual absence separately from a simulated access/read failure without leaking paths", async () => {
    const path = join(tmpdir(), `taki-d1a-missing-${randomUUID()}`);
    await expect(candidateFile(path, "core")).rejects.toMatchObject({ refusal: { reason: "absent", subject: "core" } });
    const denied = vi.spyOn(fs, "lstat").mockRejectedValueOnce(Object.assign(new Error("private path"), { code: "EACCES" }));
    try {
      await expect(candidateFile(path, "archive")).rejects.toMatchObject({ message: "HINDSIGHT_CANDIDATE_UNREADABLE",
        refusal: { reason: "unreadable", subject: "archive", name: null } });
    } finally { denied.mockRestore(); }
    const failed = vi.spyOn(fs, "lstat").mockRejectedValueOnce(Object.assign(new Error("device failure"), { code: "EIO" }));
    try { await expect(candidateDigest(path, "archive")).rejects.toMatchObject({ refusal: { reason: "unreadable" } }); }
    finally { failed.mockRestore(); }
  });
});
