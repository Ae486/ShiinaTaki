/**
 * INPUT:  process env — TAKI_CREDENTIALS_DIRECTORY / CREDENTIALS_DIRECTORY (systemd LoadCredentialEncrypted=) or
 *         TAKI_SECRET_KEY_HELPER (+ TAKI_SECRET_KEY_ACCOUNT) pointing at the taki-secret-key helper binary
 * OUTPUT: resolveMasterKeySource(env) -> MasterKeySource | null; read() -> 32 key bytes or null (absent = locked);
 *         create(key) provisions create-only through the helper (randomness stays in Core's libsodium keygen)
 * POS:    core/secrets — the bootstrap-key seam ONLY (one master key; application secrets live in the catalog).
 *         Fail-closed: a missing/short/undecodable key is null, never an error surface, and key bytes never
 *         appear in any error text
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { isSecretCatalogKey } from "./secret-catalog-envelope.ts";

const CREDENTIAL_FILE_NAME = "taki-secret-catalog-master-key";
const DEFAULT_HELPER_ACCOUNT = "secret-catalog-master-key-v1";
const HELPER_TIMEOUT_MS = 10_000;

export interface MasterKeySource {
  kind: "credentials-directory" | "key-helper";
  /** The 32-byte key, or null when absent/invalid — null means LOCKED, never "generate silently". */
  read(): Uint8Array | null;
  /** Whether this source can provision a first key (helper create mode; the credentials dir is read-only). */
  readonly canCreate: boolean;
  /** Provision the given key create-only; throws a sanitized message on any refusal. */
  create(key: Uint8Array): void;
}

/** The account model is frozen (design.md): Core and the helper run as the same logged-in interactive user. */
export function resolveMasterKeySource(env: Record<string, string | undefined>): MasterKeySource | null {
  const credentialsDir = env.TAKI_CREDENTIALS_DIRECTORY ?? env.CREDENTIALS_DIRECTORY;
  if (credentialsDir !== undefined && credentialsDir !== "") {
    return credentialsDirectorySource(credentialsDir);
  }
  const helper = env.TAKI_SECRET_KEY_HELPER;
  if (helper !== undefined && helper !== "") {
    return helperSource(helper, env.TAKI_SECRET_KEY_ACCOUNT ?? DEFAULT_HELPER_ACCOUNT);
  }
  return null;
}

function credentialsDirectorySource(dir: string): MasterKeySource {
  return {
    kind: "credentials-directory",
    canCreate: false,
    read() {
      let raw: Buffer;
      try {
        raw = readFileSync(join(dir, CREDENTIAL_FILE_NAME));
      } catch {
        return null;
      }
      const key = Uint8Array.from(raw);
      raw.fill(0); // best-effort zero of the bootstrap read buffer (frozen research §5.2)
      return isSecretCatalogKey(key) ? key : null;
    },
    create() {
      throw new Error("the credentials directory is read-only; provision the key file out-of-band");
    },
  };
}

function helperSource(helperPath: string, account: string): MasterKeySource {
  return {
    kind: "key-helper",
    canCreate: true,
    read() {
      const result = spawnSync(helperPath, ["get", "--account", account], { timeout: HELPER_TIMEOUT_MS, maxBuffer: 4096, windowsHide: true });
      if (result.error !== undefined || result.status !== 0) return null; // exit 3 (missing) and any failure lock
      const key = decodeFramedKey(result.stdout);
      return key !== null && isSecretCatalogKey(key) ? key : null;
    },
    create(key) {
      const result = spawnSync(helperPath, ["create", "--account", account], {
        input: Buffer.from(frameKey(key)),
        timeout: HELPER_TIMEOUT_MS,
        maxBuffer: 4096,
        windowsHide: true,
      });
      if (result.error !== undefined) {
        throw new Error(`secret key helper failed to launch (${(result.error as NodeJS.ErrnoException).code ?? "unknown"})`);
      }
      if (result.status !== 0) throw new Error(`secret key helper refused create (exit ${result.status ?? "signal"})`);
    },
  };
}

/** `[u32 LE length][bytes]` — the framing contract shared with the taki-secret-key helper. */
export function frameKey(key: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + key.length);
  new DataView(framed.buffer).setUint32(0, key.length, true);
  framed.set(key, 4);
  return framed;
}

export function decodeFramedKey(stdout: Uint8Array): Uint8Array | null {
  if (stdout.length < 4) return null;
  const length = new DataView(stdout.buffer, stdout.byteOffset).getUint32(0, true);
  const key = stdout.subarray(4);
  return key.length === length && length > 0 ? key : null;
}
