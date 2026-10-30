/**
 * INPUT:  durable original application jobs, an authenticated D77 client and one caller deadline
 * OUTPUT: exact-identity upload/commit recovery, verified historical receipts and explicit pending outcomes
 * POS:    core/memory/hindsight — no scheduler or replica publication; stop settles owned work before SQLite closes
 */
import type { HindsightErrorCode, TakiApplicationFailureCode, TakiApplicationCommitReceipt } from "@taki/shared";
import type { HindsightApplicationCommandRepo } from "../../db/hindsight-application-command-repo.ts";
import { HindsightApplicationCommandKeySchema, type HindsightApplicationCommandKey,
  type HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import { HindsightApplicationRefusal, type HindsightApplicationClient } from "./hindsight-application-client.ts";
import { hindsightApplicationDeadline, uploadHindsightApplicationBody, loadHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { applicationCommandStatusReceipt, verifyApplicationCommandReceiptHeader } from "./hindsight-application-command-receipt.ts";
import { HindsightError, hindsightError } from "./hindsight-errors.ts";

export type HindsightApplicationCommandRunResult =
  | { status: "completed" | "refused"; job: HindsightApplicationCommandJob }
  | { status: "pending"; job: HindsightApplicationCommandJob; outcome: "not_dispatched" | "unknown";
      code: HindsightErrorCode; refusalCode?: TakiApplicationFailureCode };
export interface HindsightApplicationCommandRunner {
  run(input: { key: HindsightApplicationCommandKey; context: HindsightCallContext }): Promise<HindsightApplicationCommandRunResult>;
  /** Irreversible for this runner instance. Stops queued work and prevents late network callbacks from writing SQLite. */
  stop(): Promise<void>;
  settle(): Promise<void>;
}
interface Dependencies { repo: HindsightApplicationCommandRepo; client: HindsightApplicationClient }
interface Execution extends Dependencies { key: HindsightApplicationCommandKey; call: () => HindsightCallContext }

export function createHindsightApplicationCommandRunner(deps: Dependencies): HindsightApplicationCommandRunner {
  const controller = new AbortController();
  const queued = new Map<string, Promise<HindsightApplicationCommandRunResult>>();
  const active = new Set<Promise<HindsightApplicationCommandRunResult>>();
  const settle = async () => {
    // New work can join during ordinary settle; stop first makes the set closed at shutdown.
    while (active.size) await Promise.allSettled([...active]);
  };
  return {
    run: (input) => {
      if (controller.signal.aborted) return Promise.reject(hindsightError("HINDSIGHT_CANCELLED"));
      if (input.context.timeoutMs > 2_147_483_647) return Promise.reject(hindsightError("HINDSIGHT_TIMEOUT"));
      const key = HindsightApplicationCommandKeySchema.parse(input.key);
      const id = JSON.stringify([key.authorityEpochId, key.bankId, key.requestId]);
      const signal = input.context.signal ? AbortSignal.any([controller.signal, input.context.signal]) : controller.signal;
      const call = hindsightApplicationDeadline({ ...input.context, signal });
      const task = (queued.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => execute({ ...deps, key, call }));
      active.add(task); queued.set(id, task);
      const release = () => { active.delete(task); if (queued.get(id) === task) queued.delete(id); };
      void task.then(release, release); return task;
    },
    stop: () => { controller.abort(); return settle(); },
    settle,
  };
}

async function execute(ctx: Execution): Promise<HindsightApplicationCommandRunResult> {
  ctx.call();
  let job = ctx.repo.get(ctx.key);
  if (!job) throw new Error("MEMORY_NOT_FOUND");
  if (job.state === "completed" || job.state === "refused") return { status: job.state, job };
  try {
    if (job.state === "dispatched") {
      const context = ctx.call(); const original = job;
      const status = await remote(() => ctx.client.applicationCommit({ bankId: original.key.bankId,
        namespace: original.namespace, operationId: original.operationId, context }), context);
      ctx.call();
      const receipt = applicationCommandStatusReceipt({ job, status });
      if (receipt) return await acceptReceipt(ctx, { job, receipt });
    }
    const scope = { bankId: job.key.bankId, namespace: job.namespace };
    for (const body of [...job.bodies, job.commands]) {
      const context = ctx.call();
      await remote(() => uploadHindsightApplicationBody({ ...scope, client: ctx.client, body, context }), context);
    }
    ctx.call();
    job = ctx.repo.markDispatched({ key: job.key, revision: job.revision });
    // The durable dispatch marker precedes the first commit byte. An absent status only authorizes this original request.
    const context = ctx.call(); const original = job;
    const receipt = await remote(() => ctx.client.commitApplication({ bankId: original.key.bankId, request: original.request, context }), context);
    ctx.call(); return await acceptReceipt(ctx, { job, receipt });
  } catch (error) {
    if (error instanceof HindsightError) return pending(job, error.code);
    if (error instanceof CommandPending) return pending(job, error.code, error.refusalCode);
    throw error;
  }
}

async function acceptReceipt(ctx: Execution, input: {
  job: HindsightApplicationCommandJob; receipt: TakiApplicationCommitReceipt;
}): Promise<HindsightApplicationCommandRunResult> {
  const { job } = input; const receipt = verifyApplicationCommandReceiptHeader(input);
  const scope = { bankId: job.key.bankId, namespace: job.namespace };
  let affectedVersionsBody = null;
  if (receipt.affected_versions_ref) {
    const context = ctx.call(); const ref = receipt.affected_versions_ref;
    affectedVersionsBody = await remote(() => loadHindsightApplicationBody({ ...scope, client: ctx.client, ref, context }), context);
  }
  ctx.call();
  const completed = ctx.repo.recordReceipt({ key: job.key, revision: job.revision, receipt, affectedVersionsBody });
  return { status: receipt.state, job: completed };
}

function pending(job: HindsightApplicationCommandJob, code: HindsightErrorCode, refusalCode?: TakiApplicationFailureCode): HindsightApplicationCommandRunResult {
  // Use the last synchronously observed job. Cancellation/stop must not cause a final read after the database closes.
  return { status: "pending", job, outcome: job.state === "prepared" ? "not_dispatched" : "unknown", code,
    ...(refusalCode === undefined ? {} : { refusalCode }) };
}

class CommandPending extends Error {
  readonly code: HindsightErrorCode;
  readonly refusalCode?: TakiApplicationFailureCode;
  constructor(code: HindsightErrorCode, refusalCode?: TakiApplicationFailureCode) {
    super(code); this.code = code; this.refusalCode = refusalCode;
  }
}

async function remote<T>(action: () => Promise<T>, context: HindsightCallContext): Promise<T> {
  try { return await interruptible(action, context); }
  catch (error) {
    if (error instanceof HindsightError) throw error;
    if (error instanceof HindsightApplicationRefusal) {
      if (error.refusal.code === "request_id_conflict") throw new Error("MEMORY_REQUEST_ID_CONFLICT", { cause: error });
      if (error.refusal.code === "body_conflict" || error.refusal.code === "body_integrity_error") throw new Error("MEMORY_INTEGRITY_ERROR", { cause: error });
      throw new CommandPending("HINDSIGHT_STATE_CONFLICT", error.refusal.code);
    }
    if (error instanceof Error && ["MEMORY_INTEGRITY_ERROR", "HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR",
      "HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH", "HINDSIGHT_APPLICATION_PAYLOAD_TOO_LARGE"].includes(error.message)) throw error;
    // A transport may lose the ACK after commit. Its exception text is never a receipt or a safe diagnostic.
    throw new CommandPending("HINDSIGHT_UNREACHABLE");
  }
}

function interruptible<T>(action: () => Promise<T>, context: HindsightCallContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { value: T } | { error: unknown }) => {
      if (settled) return; settled = true; clearTimeout(timer); context.signal?.removeEventListener("abort", abort);
      if ("error" in outcome) reject(outcome.error); else resolve(outcome.value);
    };
    const abort = () => finish({ error: hindsightError("HINDSIGHT_CANCELLED") });
    const timer = setTimeout(() => finish({ error: hindsightError("HINDSIGHT_TIMEOUT") }), context.timeoutMs);
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) { abort(); return; }
    // The late branch is observed but cannot resume the caller after cancellation. Body helpers also check this
    // same signal before each subsequent part, so an abort-ignoring transport cannot schedule more writes.
    try { void action().then((value) => finish({ value }), (error: unknown) => finish({ error })); }
    catch (error) { finish({ error }); }
  });
}
