/**
 * INPUT: trusted creation/control requests against one exact private child
 * OUTPUT: immutable selected context, addressable conversation reads and durable stop CAS
 * POS: core/db — child continuity owner; cancellation dispatch belongs to the Run service
 */
import { randomUUID } from "node:crypto";
import { SubagentConversationSchema, SubagentTargetSchema,
  type SubagentInitialContext, type SubagentTarget } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { readSubagent, readSubagentInput } from "./subagent-readers.ts";
import { prepareRunMessageBatch } from "./run-message-repo.ts";

export function createSubagentRepo(db: Database) {
  return {
    create(input: { characterId: string; createdByRunId: string; label: string; initialContext: SubagentInitialContext }) {
      const value = SubagentConversationSchema.parse({ ...input, subagentId: randomUUID(), createdAt: new Date().toISOString(),
        initialContextDigest: "0".repeat(64), stopOrigin: null, controlVersion: 0, nextInputSeq: 1, activeRunId: null });
      if (value.initialContext.kind === "snapshot") value.initialContext.messages = prepareRunMessageBatch({
        stepNumber: 0, entryKind: "output", messages: value.initialContext.messages }).messages;
      value.initialContextDigest = digestRunValue(value.initialContext);
      db.transaction(() => {
        if (readRunById(db, value.createdByRunId).characterId !== value.characterId) throw new Error("SUBAGENT_CHARACTER_MISMATCH");
        db.prepare(`INSERT INTO subagent_conversations
          (subagent_id,character_id,created_by_run_id,label,initial_context_json,initial_context_digest,created_at)
          VALUES (:id,:character,:parent,:label,:context,:digest,:at)`)
          .run({ id: value.subagentId, character: value.characterId, parent: value.createdByRunId, label: value.label,
            context: JSON.stringify(value.initialContext), digest: value.initialContextDigest, at: value.createdAt });
      });
      return value;
    },
    get: (subagentId: string) => readSubagent(db, subagentId),
    list(input: { characterId: string; afterId?: string; limit?: number }) {
      const rows = db.prepare(`SELECT subagent_id FROM subagent_conversations
        WHERE character_id=:character AND (:after IS NULL OR subagent_id>:after) ORDER BY subagent_id LIMIT :limit`)
        .all({ character: input.characterId, after: input.afterId ?? null, limit: Math.max(1, Math.min(input.limit ?? 50, 200)) });
      return rows.map((row) => readSubagent(db, String(row.subagent_id)));
    },
    stop(input: { target: SubagentTarget; origin: "user" | "parent"; cancelRunTx?: (runId: string) => void }) {
      const target = SubagentTargetSchema.parse(input.target);
      let changed = false;
      db.transaction(() => {
        const child = readSubagent(db, target.subagentId);
        const work = readSubagentInput(db, target.workInputId);
        if (work.subagentId !== child.subagentId || work.kind !== "work") throw new Error("SUBAGENT_WORK_MISMATCH");
        if (child.activeRunId && db.prepare("SELECT work_input_id FROM subagent_executions WHERE run_id=:run")
          .get({ run: child.activeRunId })?.work_input_id !== work.inputId) throw new Error("SUBAGENT_WORK_MISMATCH");
        assertControl(child, target);
        if (child.stopOrigin === "user" || child.stopOrigin === input.origin) return;
        if (child.activeRunId && !input.cancelRunTx) throw new Error("SUBAGENT_CANCEL_PARTICIPANT_REQUIRED");
        db.prepare(`UPDATE subagent_conversations SET stop_origin=:origin,control_version=control_version+1
          WHERE subagent_id=:id`).run({ origin: input.origin, id: child.subagentId });
        if (child.activeRunId) input.cancelRunTx?.(child.activeRunId);
        changed = true;
      });
      return { conversation: readSubagent(db, target.subagentId), changed };
    },
  };
}

function assertControl(child: { activeRunId: string | null; controlVersion: number }, target: SubagentTarget): void {
  if (child.controlVersion !== target.expectedControlVersion
    || (target.expectedRunId !== undefined && child.activeRunId !== target.expectedRunId)) throw new Error("SUBAGENT_CONTROL_CONFLICT");
}
export type SubagentRepo = ReturnType<typeof createSubagentRepo>;
