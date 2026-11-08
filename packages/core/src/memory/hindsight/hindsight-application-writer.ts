/**
 * INPUT:  a stable Core intent and lazily prepared application artifact commands
 * OUTPUT: shared preparation clock, original command recovery and independently verified receipt/application status
 * POS:    core/memory/hindsight — common D77 write seam; model retries never regenerate a persisted command
 */
import type { JsonValue, TakiApplicationArtifactVersion, TakiApplicationCommand } from "@taki/shared";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightApplicationCommandRepo } from "../../db/hindsight-application-command-repo.ts";
import { applicationCommandIntentHash, type HindsightApplicationCommandGuard,
  type HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import type { HindsightApplicationCommandRunner } from "./hindsight-application-command-runner.ts";
import { prepareHindsightApplicationBody } from "./hindsight-application-body-transfer.ts";
import { sameApplicationValue, type HindsightApplicationBody } from "./hindsight-application-integrity.ts";

export interface HindsightApplicationWriteInput extends HindsightApplicationCommandGuard {
  intent: JsonValue;
  create(at: string): { commands: TakiApplicationCommand[]; bodies: HindsightApplicationBody[] };
}

export function createHindsightApplicationWriter(input: {
  commands: HindsightApplicationCommandRepo; runner: HindsightApplicationCommandRunner;
  replica: HindsightApplicationReplicaRepo; now?: () => string;
}) {
  const now = () => input.now?.() ?? new Date().toISOString();
  const prepare = (work: HindsightApplicationWriteInput): HindsightApplicationCommandJob => {
    const existing = input.commands.get(work.key);
    if (existing) {
      if (!sameApplicationValue(existing.namespace, work.namespace) || existing.intentHash !== applicationCommandIntentHash(work)) {
        throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      }
      return existing;
    }
    const plan = work.create(now());
    const commands = prepareHindsightApplicationBody({ bankId: work.key.bankId, namespace: work.namespace,
      schema: "application-commands.v1", value: { commands: plan.commands } });
    return input.commands.prepare({ ...work, commands, bodies: plan.bodies });
  };
  return { prepare, now, get: input.commands.get, unfinishedBinding: input.commands.unfinishedBinding, run: input.runner.run,
    applied: (job: HindsightApplicationCommandJob) => applicationCommandApplied(input.replica, job),
    stop: input.runner.stop, settle: input.runner.settle };
}
export type HindsightApplicationWriter = ReturnType<typeof createHindsightApplicationWriter>;

export function applicationCommandApplied(repo: HindsightApplicationReplicaRepo, job: HindsightApplicationCommandJob): boolean {
  if (job.state !== "completed" || !job.receipt?.checkpoint || !job.affectedVersionsBody) return false;
  const checkpoint = repo.checkpoint(job.key.bankId);
  if (!checkpoint || checkpoint.authorityEpochId !== job.key.authorityEpochId
    || !sameApplicationValue(checkpoint.namespace, job.namespace) || checkpoint.bankDeleted
    || checkpoint.checkpoint.native_cursor < job.receipt.checkpoint.native_cursor
    || checkpoint.checkpoint.state_cursor < job.receipt.checkpoint.state_cursor) return false;
  const content = job.affectedVersionsBody.content;
  if (content.body_schema !== "application-affected-versions.v1") throw new Error("MEMORY_INTEGRITY_ERROR");
  // Cursor coverage is necessary but not sufficient: each exact historical
  // artifact receipt must actually exist in the verified local closure.
  return content.value.artifacts.every((version: TakiApplicationArtifactVersion) =>
    repo.artifact({ bankId: job.key.bankId, namespace: job.namespace, version }) !== undefined);
}
