/**
 * INPUT:  the explicitly authorized D78 working copy and task-only process environment
 * OUTPUT: confined metadata, stable retry identities and content-free progress records
 * POS:    isolated real-data validation support; never opens original storage or credentials
 */
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export const SNAPSHOT_SHA256 = "e0347289db3004be5778be7d0805177e2e596930c248a6547173de6b915e3977";
export const EXPECTED_EPOCH_ID = "b5d0b188-8b10-4847-b51a-41149f5b9dd2";
const OWNED_RUN_IDS = ["06acadec47e7", "cd01c5453b1e", "654131f0175a"] as const;
export const OWNED_RUN_ID = selectOwnedRunId(process.env.TAKI_D78_RUN_ID);
const WORKSPACE = realpathSync(fileURLToPath(new URL("../../../../../", import.meta.url)));
const OWNED_DIRECTORY = join(WORKSPACE, ".trellis", ".runtime", "d78-real-data", OWNED_RUN_ID);

export interface SourceAudit {
  tables: Array<{ table: string; count: number; sha256: string }>;
  b2Sha256: string;
  canonicalSha256: string;
  authoritySha256: string;
  blocksSha256: string;
  sha256: string;
}

export interface RealDataCommand {
  sourceBankId: string;
  bankId: string;
  preparationId: string;
  operationId: string;
  verificationId: string;
  replicaEpochId: string;
}

export interface RealDataState {
  schemaVersion: 1;
  runDirectoryId: string;
  sourceSnapshotSha256: string;
  sourceAudit: SourceAudit;
  sourceEpochId: string;
  b2RunId: string;
  b2SnapshotId: string;
  originalMigrationCount: number;
  originalMigrationSha256: string;
  manifestId: string | null;
  captureId: string | null;
  endpoint: string | null;
  providerLineage: string | null;
  commands: RealDataCommand[];
  counters: { transferDispatches: number; verificationAdvances: number; reopenCount: number };
  acknowledgements: { import: "pending" | "lost" | "recovered"; verification: "pending" | "lost" | "recovered" };
  acknowledgementIds: { import: string | null; verification: string | null };
}

export function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

/** Only the literal owner-approved isolated histories may be selected; paths and unlisted IDs are not configuration. */
export function selectOwnedRunId(input: string | undefined): typeof OWNED_RUN_IDS[number] {
  const candidate = input === undefined ? OWNED_RUN_IDS[0] : input;
  const selected = OWNED_RUN_IDS.find((runId) => runId === candidate);
  requireCondition(selected, "REAL_DATA_RUN_ID_REFUSED");
  return selected;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function failureCode(error: unknown): string {
  if (!(error instanceof Error)) return "REAL_DATA_FAILED";
  if (/^(?:HINDSIGHT_|MEMORY_|REAL_DATA_)[A-Z0-9_]+(?::[a-z0-9_]+)?$/.test(error.message)) return error.message;
  if (error.message === "LEASE_LOST") return error.message;
  if ("code" in error && error.code === "ERR_SQLITE_ERROR") return "ERR_SQLITE_ERROR";
  if (error.name === "ZodError") return "REAL_DATA_SCHEMA_INVALID";
  return "REAL_DATA_FAILED";
}

/** The selected allow-listed run accepts only its exact named copy and rejects physical path redirection. */
export function requireOwnedCopy(path: string): string {
  const expected = join(OWNED_DIRECTORY, "validation.sqlite");
  requireCondition(samePath(resolve(path), expected), "REAL_DATA_COPY_PATH_REFUSED");
  requireCondition(samePath(realpathSync(path), expected), "REAL_DATA_COPY_LINK_REFUSED");
  const file = lstatSync(path);
  requireCondition(file.isFile() && !file.isSymbolicLink() && file.nlink === 1, "REAL_DATA_COPY_LINK_REFUSED");
  return expected;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function requireOwnedEndpoint(endpoint: string): string {
  requireCondition(process.env.TAKI_D78_REAL_DATA === "1", "REAL_DATA_AUTHORIZATION_MISSING");
  requireCondition(process.env.TAKI_D78_OWNED_ENDPOINT === endpoint, "REAL_DATA_ENDPOINT_REFUSED");
  requireCondition(Boolean(process.env.TAKI_D78_API_KEY?.trim()), "HINDSIGHT_SECRET_UNAVAILABLE");
  const url = new URL(endpoint);
  requireCondition(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port
    && url.origin === endpoint && !url.username && !url.password && !url.search && !url.hash,
  "REAL_DATA_ENDPOINT_REFUSED");
  return endpoint;
}

export class RealDataMetadata {
  readonly path: string;
  readonly directory: string;
  private readonly lockPath: string;
  private readonly statePath: string;
  private readonly ownerProofPath: string;
  private stoppedPriorRunnerId: number | null;
  private lockFd: number | null = null;
  state: RealDataState | null = null;

  constructor(path: string) {
    this.path = requireOwnedCopy(path);
    this.directory = dirname(this.path);
    this.lockPath = join(this.directory, "current-cutover-real-data.lock");
    this.statePath = join(this.directory, "current-cutover-real-data-state.json");
    this.ownerProofPath = join(this.directory, "current-cutover-real-data-pending-owner.json");
    this.stoppedPriorRunnerId = preserveInterruptedRunnerOwner({ lockPath: this.lockPath, proofPath: this.ownerProofPath });
    this.lockFd = openSync(this.lockPath, "wx");
    try {
      writeFileSync(this.lockFd, JSON.stringify({ processId: process.pid, runDirectoryId: OWNED_RUN_ID }), "utf8");
      if (existsSync(this.statePath)) this.state = readState(this.statePath);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  save(): void {
    requireCondition(this.state, "REAL_DATA_STATE_MISSING");
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.statePath);
  }

  requireStoppedPriorRunner(): number {
    requireCondition(this.lockFd !== null && this.stoppedPriorRunnerId !== null
      && readInterruptedRunnerOwner(this.ownerProofPath) === this.stoppedPriorRunnerId, "REAL_DATA_B3_INTERRUPTED_OWNER_UNPROVEN");
    return this.stoppedPriorRunnerId;
  }

  consumeStoppedPriorRunner(processId: number): void {
    requireCondition(this.requireStoppedPriorRunner() === processId, "REAL_DATA_B3_INTERRUPTED_OWNER_UNPROVEN");
    consumeInterruptedRunnerOwner(this.ownerProofPath, processId);
    this.stoppedPriorRunnerId = null;
  }

  report(code: string, metadata: Record<string, unknown> = {}): void {
    const value = { code, at: new Date().toISOString(), ...metadata };
    const line = `${JSON.stringify(value)}\n`;
    appendFileSync(join(this.directory, "current-cutover-real-data-events.jsonl"), line, { encoding: "utf8", mode: 0o600 });
    process.stdout.write(line);
  }

  close(): void {
    if (this.lockFd === null) return;
    closeSync(this.lockFd);
    this.lockFd = null;
    unlinkSync(this.lockPath);
  }
}

/** Pending owner evidence outlives preflight processes and early failures; only successful recovery consumes it. */
export function preserveInterruptedRunnerOwner(input: { lockPath: string; proofPath: string }): number | null {
  const prior = readInterruptedRunnerOwner(input.proofPath);
  if (!existsSync(input.lockPath)) return prior;
  const raw = readFileSync(input.lockPath, "utf8");
  const lock: unknown = JSON.parse(raw);
  requireCondition(lock !== null && typeof lock === "object" && "processId" in lock && "runDirectoryId" in lock
    && lock.runDirectoryId === OWNED_RUN_ID && typeof lock.processId === "number"
    && Number.isSafeInteger(lock.processId) && lock.processId > 0, "REAL_DATA_RUNNER_LOCK_INVALID");
  let stopped = false;
  try { process.kill(lock.processId, 0); }
  catch (error) { stopped = error !== null && typeof error === "object" && "code" in error && error.code === "ESRCH"; }
  requireCondition(stopped && readFileSync(input.lockPath, "utf8") === raw, "REAL_DATA_RUNNER_LOCKED");
  if (prior === null) {
    const temporary = `${input.proofPath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, runDirectoryId: OWNED_RUN_ID,
      sourceSnapshotSha256: SNAPSHOT_SHA256, processId: lock.processId, observedAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, input.proofPath);
  }
  // Persist the stopped-owner proof before removing its transient lock, including when the next process is preflight.
  unlinkSync(input.lockPath);
  return prior ?? lock.processId;
}

function readInterruptedRunnerOwner(path: string): number | null {
  if (!existsSync(path)) return null;
  const proof: unknown = JSON.parse(readFileSync(path, "utf8"));
  requireCondition(proof !== null && typeof proof === "object" && "schemaVersion" in proof && proof.schemaVersion === 1
    && "runDirectoryId" in proof && proof.runDirectoryId === OWNED_RUN_ID
    && "sourceSnapshotSha256" in proof && proof.sourceSnapshotSha256 === SNAPSHOT_SHA256
    && "processId" in proof && typeof proof.processId === "number" && Number.isSafeInteger(proof.processId)
    && proof.processId > 0, "REAL_DATA_RUNNER_OWNER_PROOF_INVALID");
  return proof.processId;
}

export function consumeInterruptedRunnerOwner(path: string, processId: number): void {
  requireCondition(readInterruptedRunnerOwner(path) === processId, "REAL_DATA_B3_INTERRUPTED_OWNER_UNPROVEN");
  unlinkSync(path);
}

/** Only the run-mode CLI installs this listener. Unrecognized input is discarded without logging its content. */
export function listenForOperatorAbort(stream: Readable, onAbort: () => void): () => void {
  let line = "";
  let oversized = false;
  let cancelled = false;
  const abort = () => {
    if (cancelled) return;
    cancelled = true;
    onAbort();
  };
  const onData = (chunk: string) => {
    for (const character of chunk) {
      if (character === "\n") {
        if (!oversized && line === "abort") abort();
        line = "";
        oversized = false;
      } else if (!oversized) {
        line += character;
        if (line.length > 5) { line = ""; oversized = true; }
      }
    }
  };
  stream.setEncoding("utf8");
  // EOF or a closed parent pipe retires the operator-owned run just like the explicit abort line.
  stream.on("end", abort);
  stream.on("close", abort);
  stream.on("data", onData);
  stream.resume();
  if (stream.readableEnded || stream.destroyed) abort();
  return () => {
    stream.off("data", onData);
    stream.off("end", abort);
    stream.off("close", abort);
    stream.pause();
    line = "";
  };
}

function readState(path: string): RealDataState {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  requireCondition(value !== null && typeof value === "object" && !Array.isArray(value), "REAL_DATA_STATE_INVALID");
  const state = value as RealDataState;
  requireCondition(state.schemaVersion === 1 && state.runDirectoryId === OWNED_RUN_ID
    && state.sourceSnapshotSha256 === SNAPSHOT_SHA256 && state.sourceEpochId === EXPECTED_EPOCH_ID
    && typeof state.b2RunId === "string" && Array.isArray(state.commands)
    && /^[0-9a-f]{64}$/.test(state.sourceAudit?.sha256 ?? ""), "REAL_DATA_STATE_INVALID");
  return state;
}
