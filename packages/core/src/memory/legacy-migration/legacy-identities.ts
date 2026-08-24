/**
 * INPUT:  canonical legacy paths, raw/content hashes, Bank ids, ordinals, and provider-neutral payloads
 * OUTPUT: domain-separated SHA-256 identities plus canonical JSON and payload hashes
 * POS:    core/memory/legacy-migration — frozen deterministic identity contract for replay and audit
 */
import { createHash } from "node:crypto";

const encoder = new TextEncoder();

export function legacyHash(domain: string, ...fields: string[]): string {
  const encoded = [domain, ...fields].map((field) => encoder.encode(field));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(encoded.length);
  const hash = createHash("sha256").update(header);
  for (const field of encoded) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(field.byteLength);
    hash.update(length).update(field);
  }
  return `sha256:${hash.digest("hex")}`;
}

export const sourceIdentity = (relativePath: string, rawSha256: string): string =>
  legacyHash("legacy-source/v1", relativePath, rawSha256);
export const contentIdentity = (content: string): string =>
  legacyHash("legacy-content/v1", content.replace(/\r\n?/g, "\n"));
export const documentIdentity = (bankId: string, sourceId: string): string =>
  legacyHash("legacy-document/v1", bankId, sourceId);
export const operationIdentity = (bankId: string, documentId: string, rawSha256: string): string =>
  legacyHash("legacy-operation/v1", bankId, documentId, rawSha256);
export function memoryIdentity(input: { bankId: string; documentId: string; ordinal: number; payloadHash: string }): string {
  return legacyHash("legacy-memory/v1", input.bankId, input.documentId, String(input.ordinal), input.payloadHash);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalPayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonicalize(item)]));
}
