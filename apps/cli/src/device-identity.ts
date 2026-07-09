/**
 * INPUT:  a cli-device.json path under the CLI's data root
 * OUTPUT: loadOrCreateIdentity(path) -> { deviceId, token? }; saveToken(path, token) persists the reconnect token
 * POS:    cli — the client's device identity file (a sanctioned node:fs site; mirrors core's device store, prd §4/§8)
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface CliIdentity {
  deviceId: string;
  token?: string;
}

/** First run mints a stable deviceId and writes the file; later runs read it back unchanged. */
export function loadOrCreateIdentity(filePath: string): CliIdentity {
  const existing = readIdentity(filePath);
  if (existing) return existing;
  const identity: CliIdentity = { deviceId: randomUUID() };
  writeIdentity(filePath, identity);
  return identity;
}

export function saveToken(filePath: string, token: string): void {
  const current = readIdentity(filePath);
  if (!current) throw new Error(`cannot save token: identity file ${filePath} is missing`);
  writeIdentity(filePath, { ...current, token });
}

function readIdentity(filePath: string): CliIdentity | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }
  return parseIdentity(filePath, raw); // a corrupted identity file is fatal-fast
}

// Hand-validated (the CLI stays zod-free): a 2-field local file, not a cross-process protocol shape.
function parseIdentity(filePath: string, raw: string): CliIdentity {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) throw new Error(`identity file ${filePath} is malformed`);
  const { deviceId, token } = value as Record<string, unknown>;
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new Error(`identity file ${filePath} is malformed: deviceId`);
  }
  if (token !== undefined && typeof token !== "string") {
    throw new Error(`identity file ${filePath} is malformed: token`);
  }
  return token === undefined ? { deviceId } : { deviceId, token };
}

function writeIdentity(filePath: string, identity: CliIdentity): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(identity, null, 2));
  renameSync(tempPath, filePath);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
