/**
 * INPUT: validated addressed work/messages or trusted explicit continuation
 * OUTPUT: immutable idempotent inputs with separate child display order and exact work watermark
 * POS: core/db — input acceptance and first-consumption ownership, without dispatch or Memory writes
 */
import { randomUUID } from "node:crypto";
import { SubagentInputRequestSchema, SubagentReplyAcceptanceSchema, type SubagentInputRequest,
  type SubagentReplyAcceptance, type SubagentInput } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { latestWorkSeq, mapSubagentInput, readSubagent, readSubagentInput } from "./subagent-readers.ts";

export function createSubagentInputRepo(db: Database) {
  return {
    accept(candidate: SubagentInputRequest): { input: SubagentInput; reused: boolean } {
      const request = SubagentInputRequestSchema.parse(candidate);
      const digest = digestRunValue(request);
      let inputId: string = randomUUID();
      let reused = false;
      db.transaction(() => {
        const previous = db.prepare("SELECT input_id,request_digest FROM subagent_inputs WHERE subagent_id=:id AND operation_key=:key")
          .get({ id: request.subagentId, key: request.operationKey });
        if (previous) {
          if (previous.request_digest !== digest) throw new Error("SUBAGENT_INPUT_IDEMPOTENCY_CONFLICT");
          inputId = String(previous.input_id); reused = true; return;
        }
        const child = readSubagent(db, request.subagentId);
        if (request.input.kind === "message" && (request.input.expectedControlVersion !== child.controlVersion
          || (request.input.expectedRunId !== undefined && request.input.expectedRunId !== child.activeRunId))) {
          throw new Error("SUBAGENT_CONTROL_CONFLICT");
        }
        if (request.sender.kind === "parent" && readRunById(db, request.sender.runId).characterId !== child.characterId) {
          throw new Error("SUBAGENT_CHARACTER_MISMATCH");
        }
        const root = request.input.kind === "work" ? null : readSubagentInput(db, request.input.workInputId);
        if (root && (root.subagentId !== child.subagentId || root.kind !== "work")) throw new Error("SUBAGENT_WORK_MISMATCH");
        if (request.input.kind === "continue") continueControl(db, request, child);
        insertInput(db, { request, inputId, digest, inputSeq: child.nextInputSeq, root });
        db.prepare("UPDATE subagent_conversations SET next_input_seq=next_input_seq+1 WHERE subagent_id=:id")
          .run({ id: child.subagentId });
      });
      return { input: readSubagentInput(db, inputId), reused };
    },
    get: (inputId: string) => readSubagentInput(db, inputId),
    latestWorkSeq: (workInputId: string) => latestWorkSeq(db, workInputId),
    list(input: { subagentId: string; workInputId?: string; afterSeq?: number; limit?: number }) {
      return db.prepare(`SELECT * FROM subagent_inputs WHERE subagent_id=:id AND input_seq>:after
        AND (:work IS NULL OR work_input_id=:work) ORDER BY input_seq LIMIT :limit`)
        .all({ id: input.subagentId, work: input.workInputId ?? null, after: input.afterSeq ?? 0,
          limit: Math.max(1, Math.min(input.limit ?? 50, 200)) }).map(mapSubagentInput);
    },
    bindReplyAcceptance: (candidate: SubagentReplyAcceptance) => bindReplyAcceptance(db, candidate),
  };
}

function continueControl(db: Database, request: SubagentInputRequest, child: ReturnType<typeof readSubagent>): void {
  if (request.input.kind !== "continue") return;
  if (child.controlVersion !== request.input.expectedControlVersion) throw new Error("SUBAGENT_CONTROL_CONFLICT");
  if (child.activeRunId) throw new Error("SUBAGENT_EXECUTION_NOT_QUIESCENT");
  if (child.stopOrigin === "user" && request.sender.kind !== "user") throw new Error("SUBAGENT_USER_CONTINUE_REQUIRED");
  db.prepare("UPDATE subagent_conversations SET stop_origin=NULL,control_version=control_version+1 WHERE subagent_id=:id")
    .run({ id: child.subagentId });
}

function insertInput(db: Database, input: { request: SubagentInputRequest; inputId: string; digest: string; inputSeq: number; root: SubagentInput | null }): void {
  const { request, root } = input;
  const work = request.input.kind === "work" ? request.input : null;
  const workId = root?.inputId ?? input.inputId;
  const policy = work?.completionPolicy ?? root?.completionPolicy;
  if (!policy) throw new Error("SUBAGENT_WORK_MISMATCH");
  const at = new Date();
  const workExpiresAt = root?.workExpiresAt ?? new Date(at.getTime() + (work?.lifetimeMinutes ?? 0) * 60_000).toISOString();
  db.prepare(`INSERT INTO subagent_inputs
    (input_id,subagent_id,input_seq,work_input_id,work_seq,operation_key,request_digest,input_kind,sender_kind,
     sender_run_id,sender_owner_ref,direction_text,materials_json,tool_selection_json,completion_policy,work_expires_at,created_at)
    VALUES (:id,:subagent,:seq,:work,:workSeq,:key,:digest,:kind,:sender,:senderRun,:owner,:direction,:materials,:tools,:policy,:expires,:at)`)
    .run({ id: input.inputId, subagent: request.subagentId, seq: input.inputSeq, work: workId,
      workSeq: root ? latestWorkSeq(db, workId) + 1 : 1, key: request.operationKey, digest: input.digest,
      kind: request.input.kind, sender: request.sender.kind, senderRun: request.sender.kind === "parent" ? request.sender.runId : null,
      owner: request.sender.kind === "core" ? request.sender.ownerRef : null, direction: request.direction,
      materials: JSON.stringify(request.materials), tools: work?.toolSelection ? JSON.stringify(work.toolSelection) : null,
      policy, expires: workExpiresAt, at: at.toISOString() });
}
export type SubagentInputRepo = ReturnType<typeof createSubagentInputRepo>;

function bindReplyAcceptance(db: Database, candidate: SubagentReplyAcceptance): void {
  const value = SubagentReplyAcceptanceSchema.parse(candidate);
  db.transaction(() => {
    const root = readSubagentInput(db, value.workInputId);
    const child = readSubagent(db, root.subagentId);
    if (root.kind !== "work" || child.characterId !== value.characterId
      || value.expiresAt !== root.workExpiresAt
      || readRunById(db, value.acceptedRootRunId).characterId !== child.characterId) throw new Error("SUBAGENT_REPLY_BINDING_MISMATCH");
    if (root.replyAcceptance) {
      if (digestRunValue(root.replyAcceptance) !== digestRunValue(value)) throw new Error("SUBAGENT_REPLY_BINDING_CONFLICT");
      return;
    }
    db.prepare("UPDATE subagent_inputs SET reply_acceptance_json=:json WHERE input_id=:id")
      .run({ id: root.inputId, json: JSON.stringify(value) });
  });
}
