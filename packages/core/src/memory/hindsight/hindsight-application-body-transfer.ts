/**
 * INPUT:  complete typed D77 bodies or immutable body references and an authenticated application client
 * OUTPUT: preflighted immutable uploads and integrity-checked multipart downloads under the caller's deadline
 * POS:    core/memory/hindsight — body preparation precedes native dispatch; uploads are not application commit receipts
 */
import { randomUUID } from "node:crypto";
import {
  HINDSIGHT_APPLICATION_PART_BYTES, HINDSIGHT_APPLICATION_UPLOAD_BYTES, TakiApplicationBodyRefSchema,
  hindsightApplicationWireJson, parseTakiApplicationBody, type TakiApplicationBodySchema,
  type TakiApplicationBodyRef, type TakiApplicationBodyPartReceipt, type TakiApplicationBodyUploadStatus,
} from "@taki/shared";
import type { HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightApplicationClient } from "./hindsight-application-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import {
  decodeHindsightApplicationBody, hindsightApplicationBytesHash, hindsightApplicationHash,
  requireApplicationScope, sameApplicationValue, verifyHindsightApplicationBody, withoutApplicationHash,
  type HindsightApplicationBody, type HindsightApplicationScope,
} from "./hindsight-application-integrity.ts";

export function prepareHindsightApplicationBody(input: HindsightApplicationScope & {
  schema: TakiApplicationBodySchema; value: unknown; bodyId?: string;
}): HindsightApplicationBody {
  const content = parseTakiApplicationBody(input.schema, input.value);
  const bytes = new TextEncoder().encode(hindsightApplicationWireJson(input.value));
  if (bytes.byteLength > HINDSIGHT_APPLICATION_UPLOAD_BYTES) throw new Error("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
  const ref = TakiApplicationBodyRefSchema.parse({ body_id: input.bodyId ?? randomUUID(), body_schema: input.schema,
    payload_hash: hindsightApplicationHash({ ...input, domain: "body", value: input.value }),
    bytes_sha256: hindsightApplicationBytesHash(bytes), total_bytes: bytes.byteLength,
    part_bytes: HINDSIGHT_APPLICATION_PART_BYTES, total_parts: Math.ceil(bytes.byteLength / HINDSIGHT_APPLICATION_PART_BYTES) });
  return { ref, bytes, content };
}

export function hindsightApplicationDeadline(context: HindsightCallContext): () => HindsightCallContext {
  if (!Number.isSafeInteger(context.timeoutMs) || context.timeoutMs <= 0) throw hindsightError("HINDSIGHT_TIMEOUT");
  const deadline = Date.now() + context.timeoutMs;
  return () => {
    if (context.signal?.aborted) throw hindsightError("HINDSIGHT_CANCELLED");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw hindsightError("HINDSIGHT_TIMEOUT");
    return { ...context, timeoutMs: remaining };
  };
}

export async function uploadHindsightApplicationBody(input: HindsightApplicationScope & {
  client: HindsightApplicationClient; body: HindsightApplicationBody; context: HindsightCallContext;
}): Promise<TakiApplicationBodyRef> {
  const call = hindsightApplicationDeadline(input.context);
  verifyHindsightApplicationBody(input.body, input);
  if (input.body.ref.total_bytes > HINDSIGHT_APPLICATION_UPLOAD_BYTES) throw new Error("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
  const request = { namespace: input.namespace, descriptor: input.body.ref };
  const status = await input.client.uploadApplicationBody({ bankId: input.bankId, request, context: call() });
  requireBodyStatus(status, input, input.body.ref);
  if (status.state === "sealed") { call(); return input.body.ref; }
  for (let index = 0; index < input.body.ref.total_parts; index++) {
    const bytes = partBytes(input.body, index);
    const receipt = await input.client.putApplicationBodyPart({ bankId: input.bankId,
      bodyId: input.body.ref.body_id, partNumber: index, context: call(), request: {
        namespace: input.namespace, part_sha256: hindsightApplicationBytesHash(bytes), data_base64: Buffer.from(bytes).toString("base64"),
      } });
    requirePartReceipt({ receipt, ref: input.body.ref, index, bytes }, input);
  }
  const sealed = await input.client.sealApplicationBody({ bankId: input.bankId, bodyId: input.body.ref.body_id, request, context: call() });
  if (!sameApplicationValue(sealed, input.body.ref)) invalid();
  call(); return sealed;
}

export async function loadHindsightApplicationBody(input: HindsightApplicationScope & {
  client: HindsightApplicationClient; ref: TakiApplicationBodyRef; context: HindsightCallContext;
  /** A containing read owns the absolute deadline and may cap each HTTP call separately. */
  request?: () => HindsightCallContext;
}): Promise<HindsightApplicationBody> {
  const call = input.request ?? hindsightApplicationDeadline(input.context);
  const ref = TakiApplicationBodyRefSchema.parse(input.ref);
  const status = await input.client.applicationBody({ ...input, bodyId: ref.body_id, context: call() });
  requireBodyStatus(status, input, ref);
  if (status.state !== "sealed") invalid();
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < ref.total_parts; index++) {
    const part = await input.client.applicationBodyPart({ ...input, bodyId: ref.body_id, partNumber: index, context: call() });
    const bytes = Buffer.from(part.data_base64, "base64");
    if (bytes.toString("base64") !== part.data_base64) invalid();
    requirePartReceipt({ receipt: part, ref, index, bytes }, input);
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, ref.total_bytes);
  const body = decodeHindsightApplicationBody({ ...input, ref, bytes });
  call(); return body;
}

function requireBodyStatus(status: TakiApplicationBodyUploadStatus, scope: HindsightApplicationScope, ref: TakiApplicationBodyRef): void {
  requireApplicationScope(status, scope);
  if (!sameApplicationValue(status.descriptor, ref) || status.received_parts > ref.total_parts
    || status.state === "sealed" && status.received_parts !== ref.total_parts) invalid();
}

function requirePartReceipt(input: {
  receipt: TakiApplicationBodyPartReceipt; ref: TakiApplicationBodyRef; index: number; bytes: Uint8Array;
}, scope: HindsightApplicationScope): void {
  const { receipt, ref, index, bytes } = input;
  requireApplicationScope(receipt, scope);
  // GET includes the data field; only the receipt fields participate in this digest.
  const receiptValue = { namespace: receipt.namespace, bank_id: receipt.bank_id, body_id: receipt.body_id,
    part_number: receipt.part_number, part_sha256: receipt.part_sha256, total_bytes: receipt.total_bytes };
  if (receipt.body_id !== ref.body_id || receipt.part_number !== index || receipt.total_bytes !== bytes.byteLength
    || bytes.byteLength !== Math.min(ref.part_bytes, ref.total_bytes - index * ref.part_bytes)
    || hindsightApplicationBytesHash(bytes) !== receipt.part_sha256
    || hindsightApplicationHash({ ...scope, domain: "part", value: receiptValue }) !== receipt.part_hash) invalid();
}

export function applicationCommitRequest(input: HindsightApplicationScope & {
  operationId: string; commands: HindsightApplicationBody;
}) {
  if (input.commands.ref.body_schema !== "application-commands.v1") invalid();
  verifyHindsightApplicationBody(input.commands, input);
  const request = { namespace: input.namespace, operation_id: input.operationId, request_hash: "", commands_ref: input.commands.ref };
  return { ...request, request_hash: hindsightApplicationHash({ ...input, domain: "request",
    value: withoutApplicationHash(request, "request_hash") }) };
}

function partBytes(body: HindsightApplicationBody, index: number): Uint8Array {
  return body.bytes.subarray(index * body.ref.part_bytes, Math.min((index + 1) * body.ref.part_bytes, body.ref.total_bytes));
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR"); }
