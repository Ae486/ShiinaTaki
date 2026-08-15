/**
 * INPUT:  <dataDir>/host-identity.json and a UUID mint function
 * OUTPUT: loadOrCreateHostIdentity(filePath) -> immutable Core Host UUID
 * POS:    core/hosts — sanctioned Core-owned security identity file; atomic create-only publication, strict fatal reads
 */
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";

const HostIdentityFileSchema = z.strictObject({ hostId: z.uuid() });

export interface HostIdentityPublicationIo {
  link: (stagedPath: string, targetPath: string) => void;
}

const publicationIo: HostIdentityPublicationIo = { link: linkSync };

export function loadOrCreateHostIdentity(
  filePath: string,
  mint: () => string = randomUUID,
  io: HostIdentityPublicationIo = publicationIo,
): string {
  try {
    return readIdentity(filePath);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const candidate = HostIdentityFileSchema.parse({ hostId: mint() });
  const stagedPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeStagedIdentity(stagedPath, candidate);
    io.link(stagedPath, filePath);
  } catch (error) {
    if (isAlreadyExists(error)) return readIdentity(filePath);
    throw error;
  } finally {
    removeStagedIdentity(stagedPath);
  }
  return candidate.hostId;
}

function writeStagedIdentity(filePath: string, candidate: z.infer<typeof HostIdentityFileSchema>): void {
  const fd = openSync(filePath, "wx");
  try {
    writeFileSync(fd, JSON.stringify(candidate, null, 2), "utf8");
    fsyncSync(fd);
  } catch (error) {
    try {
      closeSync(fd);
    } finally {
      removeStagedIdentity(filePath);
    }
    throw error;
  }
  closeSync(fd);
}

function removeStagedIdentity(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

function readIdentity(filePath: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (isFileNotFound(error)) throw error;
    throw new Error(`host identity ${filePath} is unreadable or invalid JSON`, { cause: error });
  }
  const result = HostIdentityFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`host identity ${filePath} is malformed: ${result.error.message}`);
  return result.data.hostId;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST";
}
