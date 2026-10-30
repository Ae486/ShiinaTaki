/**
 * INPUT:  a local request key, captured D77 namespace and complete prepared command/body bytes
 * OUTPUT: validated durable-job types, separately scoped intent identity and bounded direct body closure
 * POS:    core/db — local outbox contract; wire models and byte codecs remain owned by Shared/D77
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HINDSIGHT_APPLICATION_UPLOAD_BYTES, TakiApplicationIdSchema, TakiApplicationNamespaceSchema,
  TakiApplicationBodyRefSchema, TakiApplicationTimeSchema, TakiApplicationJsonValueSchema,
  hindsightApplicationTaggedJson, hindsightApplicationWireJson, parseHindsightApplicationJson,
  type JsonValue, type TakiApplicationNamespace, type TakiApplicationCommitRequest,
  type TakiApplicationCommitReceipt, type TakiApplicationCommand,
} from "@taki/shared";
import { sameApplicationValue, verifyHindsightApplicationBody,
  type HindsightApplicationBody, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";

export const HindsightApplicationCommandKeySchema = z.strictObject({
  authorityEpochId: TakiApplicationIdSchema, bankId: TakiApplicationIdSchema, requestId: TakiApplicationIdSchema,
});
export type HindsightApplicationCommandKey = z.infer<typeof HindsightApplicationCommandKeySchema>;
export interface HindsightApplicationCommandGuard { key: HindsightApplicationCommandKey; namespace: TakiApplicationNamespace }
export const HindsightApplicationCommandMetaSchema = z.strictObject({
  key: HindsightApplicationCommandKeySchema, namespace: TakiApplicationNamespaceSchema,
  operationId: z.uuid(), intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["prepared", "dispatched", "completed", "refused"]), revision: z.int().positive(),
  preparedAt: TakiApplicationTimeSchema, dispatchedAt: TakiApplicationTimeSchema.nullable(), updatedAt: TakiApplicationTimeSchema,
});
export interface HindsightApplicationCommandJob extends z.infer<typeof HindsightApplicationCommandMetaSchema> {
  intent: JsonValue;
  request: TakiApplicationCommitRequest;
  commands: HindsightApplicationBody;
  /** Unique direct artifact bodies. The commands body is stored separately and is included in the preparation limit. */
  bodies: HindsightApplicationBody[];
  receipt: TakiApplicationCommitReceipt | null;
  affectedVersionsBody: HindsightApplicationBody | null;
}
export interface PrepareHindsightApplicationCommand extends HindsightApplicationCommandGuard {
  intent: JsonValue; commands: HindsightApplicationBody; bodies: readonly HindsightApplicationBody[];
}

export function applicationCommandIntentHash(input: HindsightApplicationCommandGuard & { intent: JsonValue }): string {
  return createHash("sha256").update(hindsightApplicationTaggedJson({
    domain: "taki-core-application-command-intent.v1", key: HindsightApplicationCommandKeySchema.parse(input.key),
    namespace: TakiApplicationNamespaceSchema.parse(input.namespace), intent: TakiApplicationJsonValueSchema.parse(input.intent),
  }), "utf8").digest("hex");
}

export function applicationCommandJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(hindsightApplicationWireJson(value));
}
export function applicationCommandJsonValue(value: unknown): JsonValue {
  if (!(value instanceof Uint8Array)) throw new Error("MEMORY_INTEGRITY_ERROR");
  return parseHindsightApplicationJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value));
}

export function applicationCommandList(commands: HindsightApplicationBody): TakiApplicationCommand[] {
  if (commands.content.body_schema !== "application-commands.v1") throw new Error("MEMORY_INVALID_REQUEST");
  return commands.content.value.commands;
}

export function verifyApplicationCommandClosure(input: {
  commands: HindsightApplicationBody; bodies: readonly HindsightApplicationBody[];
}, scope: HindsightApplicationScope): HindsightApplicationBody[] {
  const all = uniqueBodies([input.commands, ...input.bodies]);
  if ([...all.values()].reduce((total, body) => total + body.bytes.byteLength, 0) > HINDSIGHT_APPLICATION_UPLOAD_BYTES) {
    throw new Error("HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE");
  }
  for (const body of all.values()) verifyHindsightApplicationBody(body, scope);
  const required = new Set([input.commands.ref.body_id]);
  for (const command of applicationCommandList(input.commands)) {
    if (command.expected_artifact && !sameApplicationValue(command.expected_artifact.key, command.key)) invalid();
    if (command.command === "retire_artifact") continue;
    const body = all.get(command.body_ref.body_id);
    if (!body || !sameApplicationValue(body.ref, command.body_ref)
      || body.ref.body_schema !== `application-${command.key.artifact_kind}.v1`) invalid();
    required.add(body.ref.body_id);
  }
  if (required.size !== all.size) invalid();
  return [...all.values()].filter((body) => body.ref.body_id !== input.commands.ref.body_id);
}

function uniqueBodies(bodies: readonly HindsightApplicationBody[]): Map<string, HindsightApplicationBody> {
  const unique = new Map<string, HindsightApplicationBody>();
  for (const body of bodies) {
    const ref = TakiApplicationBodyRefSchema.parse(body.ref);
    if (!(body.bytes instanceof Uint8Array) || body.bytes.byteLength !== ref.total_bytes) invalid();
    const prior = unique.get(ref.body_id);
    if (prior && (!sameApplicationValue(prior.ref, ref) || !Buffer.from(prior.bytes).equals(body.bytes))) {
      throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    }
    unique.set(ref.body_id, body);
  }
  return unique;
}
function invalid(): never { throw new Error("MEMORY_INVALID_REQUEST"); }
