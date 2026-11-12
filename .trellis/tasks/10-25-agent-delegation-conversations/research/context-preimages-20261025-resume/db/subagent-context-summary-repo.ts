/**
 * INPUT: current private worker ownership, complete canonical ranges and actual model Effects
 * OUTPUT: atomic append-only summary revisions, bounded failure identities and separate summary-intent witnesses
 * POS: core/db — projection checkpoints only; raw private history and first-consumption receipts remain unchanged
 */
import { SubagentContextSummarySchema, type EffectLifecycle, type SubagentContextSummary,
  type SubagentContextSummaryWitness, type SubagentWorkToken } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { readSubagent, readSubagentExecution } from "./subagent-readers.ts";

export interface PrivateSummaryRange {
  subagentId: string; workInputId: string; expectedRevision: number; sourceFromSeq: number;
  throughSeq: number; sourceDigest: string;
}

export function createSubagentContextSummaryRepo(db: Database) {
  const latest = (workInputId: string): SubagentContextSummary | null => {
    const row = db.prepare("SELECT * FROM subagent_context_summaries WHERE work_input_id=:work ORDER BY revision DESC LIMIT 1")
      .get({ work: workInputId });
    return row ? mapSummary(row) : null;
  };
  const capture = (input: { subagentId: string; workInputId: string; throughSeq: number }): PrivateSummaryRange => {
    const previous = latest(input.workInputId);
    const range = { ...input, expectedRevision: previous?.revision ?? 0, sourceFromSeq: (previous?.throughSeq ?? 0) + 1 };
    if (range.throughSeq < range.sourceFromSeq) throw new Error("SUBAGENT_SUMMARY_EMPTY_RANGE");
    return { ...range, sourceDigest: sourceDigest(db, range, previous) };
  };
  return {
    latest, capture,
    failed(range: PrivateSummaryRange): boolean {
      return Boolean(db.prepare(`SELECT code FROM subagent_context_summary_failures
        WHERE work_input_id=:work AND revision=:revision AND source_digest=:digest`)
        .get({ work: range.workInputId, revision: range.expectedRevision, digest: range.sourceDigest }));
    },
    recordFailure(range: PrivateSummaryRange, code: string): void {
      db.prepare(`INSERT OR IGNORE INTO subagent_context_summary_failures(work_input_id,revision,source_digest,code,created_at)
        VALUES(:work,:revision,:digest,:code,:at)`).run({ work: range.workInputId, revision: range.expectedRevision,
        digest: range.sourceDigest, code, at: new Date().toISOString() });
    },
    commit(input: { range: PrivateSummaryRange; text: string; runId: string; attemptId: string;
      token: SubagentWorkToken; validateCurrent(): void }): SubagentContextSummary {
      const { expectedRevision, ...range } = input.range;
      const summary = SubagentContextSummarySchema.parse({ ...range, revision: expectedRevision + 1,
        text: input.text, runId: input.runId, attemptId: input.attemptId, createdAt: new Date().toISOString(),
      });
      db.transaction(() => {
        input.validateCurrent(); assertOwner(db, input);
        const previous = latest(summary.workInputId);
        if ((previous?.revision ?? 0) !== input.range.expectedRevision) throw new Error("SUBAGENT_SUMMARY_CONFLICT");
        if (sourceDigest(db, input.range, previous) !== summary.sourceDigest) throw new Error("SUBAGENT_SUMMARY_SOURCE_STALE");
        db.prepare(`INSERT INTO subagent_context_summaries(work_input_id,revision,subagent_id,source_from_seq,through_seq,
          source_digest,summary_text,run_id,attempt_id,created_at) VALUES(:work,:revision,:child,:start,:through,:digest,:text,:run,:attempt,:at)`)
          .run({ work: summary.workInputId, revision: summary.revision, child: summary.subagentId, start: summary.sourceFromSeq,
            through: summary.throughSeq, digest: summary.sourceDigest, text: summary.text, run: summary.runId,
            attempt: summary.attemptId, at: summary.createdAt });
      });
      return summary;
    },
    recordIntent(input: { effect: EffectLifecycle; token: SubagentWorkToken; stepNumber: number; summary: SubagentContextSummaryWitness }): void {
      const { effect, summary, token } = input;
      if (effect.kind !== "model" || effect.state !== "intent_committed" || !effect.inputDigest
        || summary.workInputId !== token.workInputId) throw new Error("SUBAGENT_SUMMARY_INTENT_MISMATCH");
      const row = db.prepare("SELECT * FROM subagent_context_summaries WHERE work_input_id=:work AND revision=:revision")
        .get({ work: summary.workInputId, revision: summary.revision });
      if (!row || row.subagent_id !== token.subagentId || row.source_digest !== summary.sourceDigest || row.through_seq !== summary.throughSeq) {
        throw new Error("SUBAGENT_SUMMARY_INTENT_MISMATCH");
      }
      db.prepare(`INSERT INTO subagent_context_summary_intents(effect_id,work_input_id,revision,source_digest,step_number)
        VALUES(:effect,:work,:revision,:digest,:step)`).run({ effect: effect.effectId, work: summary.workInputId,
        revision: summary.revision, digest: summary.sourceDigest, step: input.stepNumber });
    },
  };
}
export type SubagentContextSummaryRepo = ReturnType<typeof createSubagentContextSummaryRepo>;

function sourceDigest(db: Database, range: Omit<PrivateSummaryRange, "sourceDigest">, previous: SubagentContextSummary | null): string {
  const rows = db.prepare(`SELECT m.seq,m.batch_digest,m.input_id,m.entry_kind,m.run_id,m.attempt_id,m.step_number,
    i.request_digest,i.consumed_effect_id FROM run_messages m JOIN subagent_executions e ON e.run_id=m.run_id
    LEFT JOIN subagent_inputs i ON i.input_id=m.input_id
    WHERE e.subagent_id=:child AND m.seq>=:start AND m.seq<=:through ORDER BY m.seq`)
    .all({ child: range.subagentId, start: range.sourceFromSeq, through: range.throughSeq });
  const last = rows.at(-1);
  if (!last || last.entry_kind !== "output" || rows.some((row) => row.input_id !== null && row.consumed_effect_id === null)) {
    throw new Error("SUBAGENT_SUMMARY_INCOMPLETE_RANGE");
  }
  const outside = db.prepare(`SELECT seq FROM run_messages WHERE run_id=:run AND attempt_id=:attempt
    AND step_number=:step AND entry_kind='output' AND seq>:through LIMIT 1`)
    .get({ run: last.run_id ?? null, attempt: last.attempt_id ?? null, step: last.step_number ?? null, through: range.throughSeq });
  if (outside) throw new Error("SUBAGENT_SUMMARY_INCOMPLETE_RANGE");
  return digestRunValue({ previous: previous ? { revision: previous.revision, sourceDigest: previous.sourceDigest, text: previous.text } : null, rows });
}

function assertOwner(db: Database, input: { runId: string; attemptId: string; token: SubagentWorkToken; range: PrivateSummaryRange }): void {
  const run = readRunById(db, input.runId);
  const child = readSubagent(db, input.token.subagentId);
  const execution = readSubagentExecution(db, input.runId);
  if (run.state !== "running" || run.activeAttemptId !== input.attemptId || child.activeRunId !== input.runId || child.stopOrigin
    || child.controlVersion !== input.token.controlVersion || execution.work_input_id !== input.range.workInputId
    || input.token.workInputId !== input.range.workInputId || input.token.subagentId !== input.range.subagentId) {
    throw new Error("SUBAGENT_SUMMARY_OWNER_STALE");
  }
}

function mapSummary(row: SqlRow): SubagentContextSummary {
  return SubagentContextSummarySchema.parse({ workInputId: row.work_input_id, subagentId: row.subagent_id, revision: row.revision,
    sourceFromSeq: row.source_from_seq, throughSeq: row.through_seq, sourceDigest: row.source_digest,
    text: row.summary_text, runId: row.run_id, attemptId: row.attempt_id, createdAt: row.created_at });
}
