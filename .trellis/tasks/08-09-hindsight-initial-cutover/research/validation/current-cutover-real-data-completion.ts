/**
 * INPUT:  an owned run directory, supervisor consumer identity and the final source audit
 * OUTPUT: an atomic, non-overwriting completion receipt only after successful execution and audit
 * POS:    task supervision evidence; no provider credentials, memory content or authority mutation
 */
import { closeSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OWNED_RUN_ID, requireCondition } from "./current-cutover-real-data-state.ts";

export interface ConsumerCompletionTarget {
  directory: string;
  consumerId: string;
}

export function requireConsumerIdentity(value: string | undefined): string {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9-]+$/.test(value), "REAL_DATA_CONSUMER_ID_REFUSED");
  // The complete ASCII filename must fit the filesystem's 255-byte component limit before any model call.
  requireCondition(Buffer.byteLength(`consumer-${value}-complete.json`) <= 255, "REAL_DATA_CONSUMER_ID_REFUSED");
  return value;
}

export function requireUncompletedConsumer(target: ConsumerCompletionTarget): string {
  const consumerId = requireConsumerIdentity(target.consumerId);
  const path = join(target.directory, `consumer-${consumerId}-complete.json`);
  requireCondition(lstatSync(path, { throwIfNoEntry: false }) === undefined, "REAL_DATA_CONSUMER_ALREADY_COMPLETE");
  return path;
}

export function finalizeConsumerCompletion(input: {
  succeeded: boolean;
  exitCode?: string | number | null;
  target: ConsumerCompletionTarget | null;
  audit: () => void;
  cleanup: () => void;
  announce: () => void;
}): void {
  // Even a failed source audit must release local resources. A release failure cannot leave a success receipt.
  try { input.audit(); }
  finally { input.cleanup(); }
  if (!input.succeeded || input.exitCode !== undefined && input.exitCode !== 0) return;
  input.announce();
  if (input.target) publishCompletion(input.target);
}

function publishCompletion(target: ConsumerCompletionTarget): void {
  const path = requireUncompletedConsumer(target);
  const temporary = join(target.directory, `.consumer-completion-${randomUUID()}.tmp`);
  const file = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, runDirectoryId: OWNED_RUN_ID,
        consumerId: target.consumerId, state: "complete" })}\n`, "utf8");
      fsyncSync(file);
    } finally { closeSync(file); }
    // Hard-link publication is atomic and fails if the final name appeared after admission; rename would overwrite it.
    linkSync(temporary, path);
  } finally { unlinkSync(temporary); }
}
