/**
 * INPUT:  plain catalog instances + keys (incl. adversarial: wrong key, tampered/truncated/reordered bytes)
 * OUTPUT: the Phase 0 spike proofs pinned as unit tests over sealCatalog/openCatalog (roundtrip, wrong-key,
 *         tamper, truncation incl. missing FINAL tag, reorder/duplicate, AAD/store binding, format bounds)
 * POS:    core/secrets — pure envelope layer; failures must be sanitized SecretCatalogError categories, never
 *         partial plaintext or raw sodium messages
 */
import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";
import { SecretRefSchema } from "@taki/shared";
import {
  SECRET_CATALOG_FORMAT_VERSION,
  SecretCatalogError,
  generateCatalogKey,
  openCatalog,
  sealCatalog,
  sodiumReady,
  type SecretCatalogPlain,
} from "./secret-catalog-envelope.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const OTHER_STORE = "22222222-2222-4222-8222-222222222222";
const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";

function plain(entries: Record<string, string> = {}): SecretCatalogPlain {
  return {
    version: SECRET_CATALOG_FORMAT_VERSION,
    createdAt: "2026-08-16T00:00:00.000Z",
    keyVersion: 1,
    storeId: STORE,
    entries: Object.fromEntries(Object.entries(entries).map(([ref, value]) => [ref, { value, updatedAt: "2026-08-16T00:00:00.000Z" }])),
  };
}

function expectFailure(bytes: Uint8Array, key: Uint8Array, reason: string): void {
  try {
    openCatalog(bytes, key, STORE);
    expect.unreachable(`expected openCatalog to fail with ${reason}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SecretCatalogError);
    expect((error as SecretCatalogError).reason).toBe(reason);
    // The sanitized category contract: no sentinel leaks through the message either.
    expect((error as Error).message).not.toContain(SENTINEL);
  }
}

describe("secretstream envelope (Phase 0 proofs pinned)", () => {
  it("roundtrips entries through seal/open", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const opened = openCatalog(sealCatalog(plain({ "mcp.demo.env.KEY": SENTINEL }), key), key, STORE);
    expect(opened.entries["mcp.demo.env.KEY"]?.value).toBe(SENTINEL);
    expect(opened.keyVersion).toBe(1);
    expect(opened.storeId).toBe(STORE);
  });

  it("rejects a wrong key without rewriting or partial plaintext", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const sealed = sealCatalog(plain({ "mcp.demo.env.KEY": SENTINEL }), key);
    expectFailure(sealed, generateCatalogKey(), "auth-failed");
  });

  it("rejects a tampered ciphertext byte", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const sealed = Uint8Array.from(sealCatalog(plain({ "mcp.demo.env.KEY": SENTINEL }), key));
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 1;
    expectFailure(sealed, key, "auth-failed");
  });

  it("rejects a truncated stream (dropped bytes and mid-chunk cut)", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const sealed = sealCatalog(plain({ "mcp.demo.env.KEY": SENTINEL }), key);
    expectFailure(sealed.subarray(0, sealed.length - 8), key, "auth-failed"); // tail cut
    expectFailure(sealed.subarray(0, sealed.length - 1), key, "auth-failed"); // one byte short
  });

  it("rejects a stream whose final chunk never carried TAG_FINAL (truncation between messages)", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    // Hand-build a valid TSC1 frame around a MESSAGE-tagged (non-final) stream — the "dropped last chunk" case.
    const headerJson = new TextEncoder().encode(
      JSON.stringify({ version: 1, createdAt: "2026-08-16T00:00:00.000Z", keyVersion: 1, storeId: STORE }),
    );
    const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
      push.state,
      sodium.from_string(JSON.stringify({ version: 1, keyVersion: 1, entries: {} })),
      headerJson,
      sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
    );
    const frame = new Uint8Array(4 + 4 + headerJson.length + push.header.length + ciphertext.length);
    frame.set([0x54, 0x53, 0x43, 0x31], 0);
    new DataView(frame.buffer).setUint32(4, headerJson.length, true);
    frame.set(headerJson, 8);
    frame.set(push.header, 8 + headerJson.length);
    frame.set(ciphertext, 8 + headerJson.length + push.header.length);
    expectFailure(frame, key, "auth-failed");
  });

  it("binds the header as AAD: splicing another store's header fails closed", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const mine = sealCatalog(plain({ "mcp.demo.env.KEY": SENTINEL }), key);
    const theirs = sealCatalog({ ...plain(), storeId: OTHER_STORE }, key);
    const headerLength = new DataView(mine.buffer).getUint32(4, true);
    const theirHeaderLength = new DataView(theirs.buffer).getUint32(4, true);
    const head = theirs.subarray(0, 8 + theirHeaderLength);
    const tail = mine.subarray(8 + headerLength);
    const spliced = new Uint8Array(head.length + tail.length);
    spliced.set(head, 0);
    spliced.set(tail, head.length);
    // The storeId check fires first (public header), and even without it the AAD mismatch fails authentication.
    expectFailure(spliced, key, "wrong-store");
  });

  it("rejects bad magic and truncated frames as bad-format", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const sealed = sealCatalog(plain(), key);
    expectFailure(new Uint8Array(10), key, "bad-format");
    const noMagic = Uint8Array.from(sealed);
    noMagic[0] = 0x00;
    expectFailure(noMagic, key, "bad-format");
  });

  it("rejects an unsupported future version and a wrong-length key", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const sealed = sealCatalog(plain(), key);
    // Hand-bump the header version (still self-consistent JSON; the storeId check passes, the version check fires).
    const headerLength = new DataView(sealed.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(sealed.subarray(8, 8 + headerLength))) as Record<string, unknown>;
    header.version = SECRET_CATALOG_FORMAT_VERSION + 1;
    const bumped = new TextEncoder().encode(JSON.stringify(header));
    const frame = Uint8Array.from(sealed.subarray(0, 4));
    const rest = sealed.subarray(8 + headerLength);
    const out = new Uint8Array(4 + 4 + bumped.length + rest.length);
    out.set(frame, 0);
    new DataView(out.buffer).setUint32(4, bumped.length, true);
    out.set(bumped, 8);
    out.set(rest, 8 + bumped.length);
    expectFailure(out, key, "unsupported-version");
    expectFailure(sealed, new Uint8Array(16), "key-invalid");
  });

  it("refuses invalid refs and non-TSC1 versions at seal time", async () => {
    await sodiumReady;
    const key = generateCatalogKey();
    const badRef = plain({ "NOT A VALID REF": "x" });
    expect(() => sealCatalog(badRef, key)).toThrow();
    expect(SecretRefSchema.safeParse("NOT A VALID REF").success).toBe(false);
    expect(() => sealCatalog({ ...plain(), version: 99 }, key)).toThrow(SecretCatalogError);
  });
});
