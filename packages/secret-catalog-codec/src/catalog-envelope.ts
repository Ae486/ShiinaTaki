/**
 * INPUT:  a plain catalog (metadata + secret values) + a 32-byte master key; or sealed envelope bytes + the key
 * OUTPUT: sealCatalog()/openCatalog() over the versioned TSC1 secretstream envelope; SecretCatalogError (sanitized)
 * POS:    secret-catalog-codec — pure crypto/format core: no fs, no logs, no value-bearing messages
 */
import sodium from "libsodium-wrappers";
import { z } from "zod";
import { SecretRefSchema } from "@taki/shared/secret-catalog";

export const SECRET_CATALOG_FORMAT_VERSION = 1;

const MAGIC = Uint8Array.from([0x54, 0x53, 0x43, 0x31]); // "TSC1"
const HEADER_LENGTH_BYTES = 4;

// Fixed sanitized category messages — never interpolated with input, ciphertext, or values.
const FAILURE_MESSAGES = {
  "bad-format": "secret catalog envelope is malformed",
  "unsupported-version": "secret catalog envelope version is not supported by this build",
  "wrong-store": "secret catalog belongs to a different store",
  "auth-failed": "secret catalog failed authentication (wrong key or tampered/truncated data)",
  "key-invalid": "secret catalog master key has the wrong length",
} as const;

export type SecretCatalogFailureReason = keyof typeof FAILURE_MESSAGES;

export class SecretCatalogError extends Error {
  readonly reason: SecretCatalogFailureReason;

  constructor(reason: SecretCatalogFailureReason) {
    super(FAILURE_MESSAGES[reason]);
    this.reason = reason;
    this.name = "SecretCatalogError";
  }
}

export interface SecretCatalogEntry {
  value: string;
  updatedAt: string;
}

export interface SecretCatalogPlain {
  version: number;
  createdAt: string;
  keyVersion: number;
  storeId: string;
  entries: Record<string, SecretCatalogEntry>;
}

const HeaderSchema = z.strictObject({
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  keyVersion: z.number().int().positive(),
  storeId: z.string().min(1),
});

const PayloadSchema = z.strictObject({
  version: z.number().int().positive(),
  keyVersion: z.number().int().positive(),
  entries: z.record(SecretRefSchema, z.strictObject({ value: z.string(), updatedAt: z.iso.datetime({ offset: true }) })),
});

/** Resolve once before any crypto call; the async service factory awaits this so ops stay synchronous after boot. */
export const sodiumReady: Promise<typeof sodium> = sodium.ready.then(() => sodium);

export function isSecretCatalogKey(key: Uint8Array): boolean {
  return key.length === sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES;
}

export function generateCatalogKey(): Uint8Array {
  return sodium.crypto_secretstream_xchacha20poly1305_keygen();
}

/** Validate + serialize the public header (fixed key order — it is authentication-covered data). */
function headerBytes(plain: SecretCatalogPlain): Uint8Array {
  const header = HeaderSchema.parse({
    version: plain.version,
    createdAt: plain.createdAt,
    keyVersion: plain.keyVersion,
    storeId: plain.storeId,
  });
  if (plain.version !== SECRET_CATALOG_FORMAT_VERSION) throw new SecretCatalogError("unsupported-version");
  return sodium.from_string(JSON.stringify(header));
}

export function sealCatalog(plain: SecretCatalogPlain, key: Uint8Array): Uint8Array {
  if (!isSecretCatalogKey(key)) throw new SecretCatalogError("key-invalid");
  const header = headerBytes(plain);
  const payload = PayloadSchema.parse({ version: plain.version, keyVersion: plain.keyVersion, entries: plain.entries });

  const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
    push.state,
    sodium.from_string(JSON.stringify(payload)),
    header, // AAD: the exact public header bytes bind version/storeId/keyVersion into the tag
    sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
  );

  const framed = new Uint8Array(MAGIC.length + HEADER_LENGTH_BYTES + header.length + push.header.length + ciphertext.length);
  let offset = 0;
  framed.set(MAGIC, offset);
  offset += MAGIC.length;
  new DataView(framed.buffer).setUint32(offset, header.length, true);
  offset += HEADER_LENGTH_BYTES;
  framed.set(header, offset);
  offset += header.length;
  framed.set(push.header, offset);
  offset += push.header.length;
  framed.set(ciphertext, offset);
  return framed;
}

export function openCatalog(bytes: Uint8Array, key: Uint8Array, expectedStoreId: string): SecretCatalogPlain {
  if (!isSecretCatalogKey(key)) throw new SecretCatalogError("key-invalid");
  const streamHeaderLength = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  if (bytes.length < MAGIC.length + HEADER_LENGTH_BYTES + streamHeaderLength) throw new SecretCatalogError("bad-format");
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new SecretCatalogError("bad-format");
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length, true);
  const headerStart = MAGIC.length + HEADER_LENGTH_BYTES;
  const streamStart = headerStart + headerLength;
  if (headerLength === 0 || streamStart + streamHeaderLength > bytes.length) throw new SecretCatalogError("bad-format");

  const header = HeaderSchema.parse(parseJson(bytes.subarray(headerStart, streamStart), "bad-format"));
  if (header.version > SECRET_CATALOG_FORMAT_VERSION) throw new SecretCatalogError("unsupported-version");
  if (header.storeId !== expectedStoreId) throw new SecretCatalogError("wrong-store");

  const streamHeader = bytes.subarray(streamStart, streamStart + streamHeaderLength);
  const ciphertext = bytes.subarray(streamStart + streamHeaderLength);
  // Wrong key, tamper, truncation, reorder, duplication, and AAD mismatch all land here (verified by the Phase 0
  // spike: failures return false rather than throwing, except pre-auth length checks which we classify the same).
  let pulled: { message: Uint8Array; tag: number } | false;
  try {
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(streamHeader, key);
    pulled = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, bytes.subarray(headerStart, streamStart));
  } catch {
    throw new SecretCatalogError("auth-failed");
  }
  if (pulled === false || pulled.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
    throw new SecretCatalogError("auth-failed");
  }

  const payload = PayloadSchema.parse(parseJson(pulled.message, "bad-format"));
  if (payload.version !== header.version || payload.keyVersion !== header.keyVersion) {
    throw new SecretCatalogError("bad-format");
  }
  return {
    version: header.version,
    createdAt: header.createdAt,
    keyVersion: header.keyVersion,
    storeId: header.storeId,
    entries: payload.entries,
  };
}

function parseJson(bytes: Uint8Array, reason: SecretCatalogFailureReason): unknown {
  try {
    return JSON.parse(sodium.to_string(bytes));
  } catch {
    throw new SecretCatalogError(reason);
  }
}
