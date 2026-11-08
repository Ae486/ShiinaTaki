/**
 * INPUT:  operator-owned completed artifact paths and their previously recorded byte commitments
 * OUTPUT: regular-file and immutable-copy guards with absent/unreadable/tampered distinctions
 * POS:    candidate inspection only; never creates files, follows a final symlink or starts a copied writer
 */
import { lstat } from "node:fs/promises";
import { digestFile, errorCode, type HindsightBackupFileDigest } from "../hindsight-backup/hindsight-backup-files.ts";
import { refuse, refusalOf } from "./hindsight-candidate-refusal.ts";
import type { HindsightCandidateSubject } from "@taki/shared";

export async function candidateFile(path: string, subject: HindsightCandidateSubject) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) refuse("unsupported", subject);
    return stat;
  } catch (error) {
    if (errorCode(error) === "ENOENT") refuse("absent", subject);
    throw refusalOf(error, ["unreadable", subject]);
  }
}

export async function assertCompletedCore(path: string): Promise<void> {
  await candidateFile(path, "core");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await lstat(path + suffix); }
    catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw refusalOf(error, ["unreadable", "core"]);
    }
    refuse("unsupported", "core", { name: "live_sidecar" });
  }
}

export async function candidateDigest(path: string, subject: HindsightCandidateSubject): Promise<HindsightBackupFileDigest> {
  const before = await candidateFile(path, subject);
  try {
    const digest = await digestFile(path);
    const after = await candidateFile(path, subject);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || digest.bytes !== after.size) refuse("tampered", subject);
    return digest;
  } catch (error) { throw refusalOf(error, ["unreadable", subject]); }
}

export function assertCandidateDigest(actual: HindsightBackupFileDigest, expected: HindsightBackupFileDigest,
  subject: HindsightCandidateSubject): void {
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) refuse("tampered", subject);
}
