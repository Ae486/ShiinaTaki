/**
 * INPUT:  immutable D77 headers, exact byte bodies and their captured Bank namespace
 * OUTPUT: scoped semantic digests, native witnesses and fully checked typed body values
 * POS:    core/memory/hindsight — integrity boundary before any application-state publication or model admission
 */
import { createHash } from "node:crypto";
import {
  HINDSIGHT_APPLICATION_NATIVE_ENCODING, TakiApplicationBodyRefSchema, hindsightApplicationDigestJson,
  hindsightApplicationTaggedJson, parseTakiApplicationBody, parseHindsightApplicationJson,
  type HindsightApplicationDigestDomain, type TakiApplicationNamespace, type TakiApplicationBodyRef,
  type TakiApplicationBodyContent,
} from "@taki/shared";

export interface HindsightApplicationScope { namespace: TakiApplicationNamespace; bankId: string }
export interface HindsightApplicationBody {
  ref: TakiApplicationBodyRef;
  bytes: Uint8Array;
  content: TakiApplicationBodyContent;
}

export function hindsightApplicationHash(input: HindsightApplicationScope & {
  domain: HindsightApplicationDigestDomain; value: unknown;
}): string {
  return createHash("sha256").update(hindsightApplicationDigestJson(input), "utf8").digest("hex");
}
export function hindsightApplicationNativeHash(value: unknown): string {
  return createHash("sha256").update(hindsightApplicationTaggedJson(value, HINDSIGHT_APPLICATION_NATIVE_ENCODING), "utf8").digest("hex");
}
export function hindsightApplicationBytesHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function withoutApplicationHash(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
export function sameApplicationValue(left: unknown, right: unknown): boolean {
  return hindsightApplicationTaggedJson(left) === hindsightApplicationTaggedJson(right);
}
export function requireApplicationScope(value: { namespace: TakiApplicationNamespace; bank_id: string }, scope: HindsightApplicationScope): void {
  if (value.bank_id !== scope.bankId || !sameApplicationValue(value.namespace, scope.namespace)) {
    throw new Error("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
  }
}

export function decodeHindsightApplicationBody(input: HindsightApplicationScope & {
  ref: TakiApplicationBodyRef; bytes: Uint8Array;
}): HindsightApplicationBody {
  const ref = TakiApplicationBodyRefSchema.parse(input.ref);
  if (input.bytes.byteLength !== ref.total_bytes || hindsightApplicationBytesHash(input.bytes) !== ref.bytes_sha256) invalid();
  let value: unknown;
  try { value = parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bytes)); }
  catch { return invalid(); }
  if (hindsightApplicationHash({ ...input, domain: "body", value }) !== ref.payload_hash) invalid();
  let content: TakiApplicationBodyContent;
  try { content = parseTakiApplicationBody(ref.body_schema, value); }
  catch { return invalid(); }
  if (content.body_schema === "application-native-record.v1"
    && (content.value.payload.bank_id !== input.bankId
      || hindsightApplicationNativeHash(content.value.payload) !== content.value.version.payload_hash)) invalid();
  if (content.body_schema === "application-native-source.v1") {
    const source = content.value;
    if (source.document_version.object_kind !== "document" || (source.availability === "available") !== (source.original_text !== null)
      || hindsightApplicationHash({ ...input, domain: "source-evidence", value: withoutApplicationHash(source, "source_evidence_hash") })
        !== source.source_evidence_hash) invalid();
  }
  return { ref, bytes: input.bytes, content };
}

export function verifyHindsightApplicationBody(body: HindsightApplicationBody, scope: HindsightApplicationScope): void {
  const decoded = decodeHindsightApplicationBody({ ...scope, ref: body.ref, bytes: body.bytes });
  if (!sameApplicationValue(decoded.content, body.content)) invalid();
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR"); }
