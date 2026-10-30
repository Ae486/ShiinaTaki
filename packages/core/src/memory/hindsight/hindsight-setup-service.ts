/**
 * INPUT:  live non-secret config, Secret Catalog connection seam, focused client, compatibility gate, and SQLite repos
 * OUTPUT: explicit validate/setup/disable/status/LLM-health operator operations over resumable sanitized state
 * POS:    core/memory/hindsight — B3 orchestration only; never selects Memory Authority or performs Host actions
 */
import { randomUUID } from "node:crypto";
import {
  HindsightLlmHealthResultSchema,
  HindsightManagedDeploymentReceiptSchema,
  HindsightSetupSnapshotSchema,
  type HindsightConnectionProjection,
  type HindsightDisableParams,
  type HindsightLlmHealthParams,
  type HindsightLlmHealthResult,
  type HindsightSetupParams,
  type HindsightSetupSnapshot,
  type HindsightValidateParams,
} from "@taki/shared";
import type { HindsightResolvedConfig } from "../../config/hindsight-config.ts";
import type { HindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import type { HindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import type { HindsightCompatibilityService } from "./hindsight-compatibility-service.ts";
import { applyHindsightBank } from "./hindsight-bank-setup.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { hindsightConnectionFingerprint } from "./hindsight-compatibility-service.ts";
import { normalizeError } from "./hindsight-setup-errors.ts";
import { dryRunTemplates, setupTargets } from "./hindsight-setup-stages.ts";

/** Phases with a remote attempt in flight; a snapshot left in one by a dead process can never complete (see hindsight-setup-recovery). */
export const BUSY_SETUP_PHASES = ["validating", "validating-templates", "initializing-banks", "applying-templates", "waiting-template-operations"] as const;

export interface HindsightConnectionSecret {
  resolve(): string | null;
  marker(): string;
}

export interface HindsightSetupService {
  status(): HindsightSetupSnapshot;
  validate(params: HindsightValidateParams): Promise<HindsightSetupSnapshot>;
  setup(params: HindsightSetupParams): Promise<HindsightSetupSnapshot>;
  disable(params: HindsightDisableParams): HindsightSetupSnapshot;
  llmHealth(params: HindsightLlmHealthParams): Promise<HindsightLlmHealthResult>;
}

export interface HindsightSetupDeps {
  config(): HindsightResolvedConfig;
  secret: HindsightConnectionSecret;
  client(connection: HindsightConnectionProjection): HindsightClient;
  compatibility: HindsightCompatibilityService;
  connectionRepo: HindsightConnectionRepo;
  bankRepo: HindsightBankSetupRepo;
  authorityMode(): string;
  now?: () => string;
  attemptId?: () => string;
  wait?: (ms: number) => Promise<void>;
}

export function createHindsightSetupService(deps: HindsightSetupDeps): HindsightSetupService {
  const runtime = { now: deps.now ?? (() => new Date().toISOString()), nextAttemptId: deps.attemptId ?? randomUUID };
  return {
    status: () => read(deps),
    validate: (params) => validate({ deps, params, runtime }),
    setup: (params) => setup({ deps, params, runtime }),
    disable: (params) => disable(deps, params, runtime.now),
    llmHealth: (params) => llmHealth(deps, params),
  };
}

interface SetupRuntime {
  now: () => string;
  nextAttemptId: () => string;
}

function read(deps: HindsightSetupDeps): HindsightSetupSnapshot {
  return deps.connectionRepo.read(deps.bankRepo.list());
}

async function validate(input: {
  deps: HindsightSetupDeps;
  params: HindsightValidateParams;
  runtime: SetupRuntime;
}): Promise<HindsightSetupSnapshot> {
  const { deps, params, runtime } = input;
  requireCanonicalLocal(deps);
  const current = requireRevision(read(deps), params.expectedRevision);
  requireIdle(current);
  const connection = requireConnection(deps.config());
  const startedAt = runtime.now();
  let working = persist({ deps, current, patch: {
    phase: "validating", attemptId: runtime.nextAttemptId(), latestError: null, lastAttemptAt: startedAt,
  }, updatedAt: startedAt });
  try {
    const result = await deps.compatibility.validate({
      connection,
      secretMarker: deps.secret.marker(),
      client: deps.client(connection),
    });
    if (current.configFingerprint !== null && current.configFingerprint !== result.fingerprint) {
      deps.bankRepo.markAllPending();
    }
    working = persist({ deps, current: working, patch: {
      phase: "compatible", lastSuccessfulPhase: "compatible", configFingerprint: result.fingerprint,
      compatibility: result.compatibility, latestError: null, lastSuccessAt: runtime.now(),
    }, updatedAt: runtime.now() });
    return read(deps);
  } catch (error) {
    // Failed validation withdraws the compatibility evidence (setup/llmHealth refuse until a fresh success) while
    // the fingerprint stays so a later successful validate still detects a changed connection.
    return persistFailure({ deps, current: { ...working, compatibility: null }, error: normalizeError(error), updatedAt: runtime.now() });
  }
}

async function setup(input: {
  deps: HindsightSetupDeps;
  params: HindsightSetupParams;
  runtime: SetupRuntime;
}): Promise<HindsightSetupSnapshot> {
  const { deps, params, runtime } = input;
  requireCanonicalLocal(deps);
  const current = requireRevision(read(deps), params.expectedRevision);
  requireIdle(current);
  const configured = requireConnection(deps.config());
  const connection = managedConnection(configured, params, runtime.now());
  const fingerprint = await requireCurrentCompatibility(deps, current, connection);
  const targets = setupTargets(connection.desiredTemplateRevision, params.characterId);
  const client = deps.client(connection);
  const startedAt = runtime.now();
  let working = persist({ deps, current, patch: {
    phase: "validating-templates", attemptId: runtime.nextAttemptId(), latestError: null, lastAttemptAt: startedAt,
  }, updatedAt: startedAt });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), connection.setupTimeoutMs);
  try {
    const dryRuns = await dryRunTemplates({ targets, client, connection, signal: controller.signal, attemptId: working.attemptId });
    if (dryRuns.some((result) => result.dry_run !== true)) throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
    working = persist({ deps, current: working, patch: { phase: "initializing-banks" }, updatedAt: runtime.now() });
    working = persist({ deps, current: working, patch: { phase: "applying-templates" }, updatedAt: runtime.now() });
    const bankDeps = { bankRepo: deps.bankRepo, client, connection, wait: deps.wait ?? wait, now: runtime.now };
    for (const target of targets) {
      await applyHindsightBank({ deps: bankDeps, target, signal: controller.signal });
    }
    requireCanonicalLocal(deps);
    const banks = deps.bankRepo.list();
    working = persist({ deps, current: working, patch: {
      phase: "configured", lastSuccessfulPhase: "configured", configFingerprint: fingerprint,
      banks, latestError: null, lastSuccessAt: runtime.now(),
    }, updatedAt: runtime.now() });
    return read(deps);
  } catch (error) {
    const normalized = controller.signal.aborted ? hindsightError("HINDSIGHT_TIMEOUT") : normalizeError(error);
    return persistFailure({ deps, current: working, error: normalized, updatedAt: runtime.now() });
  } finally {
    clearTimeout(deadline);
  }
}

function disable(
  deps: HindsightSetupDeps,
  params: HindsightDisableParams,
  now: () => string,
): HindsightSetupSnapshot {
  const current = requireRevision(read(deps), params.expectedRevision);
  requireIdle(current);
  return persist({ deps, current, patch: { phase: "disabled", latestError: null, attemptId: null }, updatedAt: now() });
}

async function llmHealth(
  deps: HindsightSetupDeps,
  params: HindsightLlmHealthParams,
): Promise<HindsightLlmHealthResult> {
  requireCanonicalLocal(deps);
  const current = requireRevision(read(deps), params.expectedRevision);
  if (current.phase !== "configured") throw hindsightError("HINDSIGHT_LLM_HEALTH_UNAVAILABLE");
  const connection = requireConnection(deps.config());
  const fingerprint = hindsightConnectionFingerprint(connection, deps.secret.marker());
  if (current.configFingerprint !== fingerprint) throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  const banks = deps.bankRepo.list().filter((bank) => bank.status === "verified" && (!params.bankId || bank.externalBankId === params.bankId));
  if (banks.length === 0) throw hindsightError("HINDSIGHT_LLM_HEALTH_UNAVAILABLE");
  let working = persist({ deps, current, patch: { modelHealth: "running" }, updatedAt: new Date().toISOString() });
  const client = deps.client(connection);
  try {
    const results = [];
    for (const bank of banks) results.push(await client.bankLlmHealth(bank.externalBankId, { timeoutMs: connection.requestTimeoutMs }));
    const statuses = results.flatMap((bank) => bank.operations);
    const status = statuses.every((item) => item.ok) ? "healthy" : statuses.some((item) => item.ok) ? "degraded" : "failed";
    working = persist({ deps, current: working, patch: { modelHealth: status }, updatedAt: new Date().toISOString() });
    return HindsightLlmHealthResultSchema.parse({ status, banks: results });
  } catch (error) {
    persist({ deps, current: working, patch: { modelHealth: "failed" }, updatedAt: new Date().toISOString() });
    throw normalizeError(error);
  }
}

async function requireCurrentCompatibility(
  deps: HindsightSetupDeps,
  current: HindsightSetupSnapshot,
  connection: HindsightConnectionProjection,
): Promise<string> {
  if (!current.compatibility || !current.configFingerprint) throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  const fingerprint = hindsightConnectionFingerprint(connection, deps.secret.marker());
  if (fingerprint !== current.configFingerprint) throw hindsightError("HINDSIGHT_EXTENSION_UNSUPPORTED");
  return fingerprint;
}

function managedConnection(
  connection: HindsightConnectionProjection,
  params: HindsightSetupParams,
  observedAt: string,
): HindsightConnectionProjection {
  if (connection.deploymentMode === "existing-instance") {
    if (params.managedReceipt) throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED");
    return connection;
  }
  if (!params.managedReceipt) throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED");
  const receipt = HindsightManagedDeploymentReceiptSchema.parse(params.managedReceipt);
  const age = Date.parse(observedAt) - Date.parse(receipt.observedAt);
  if (receipt.endpoint !== connection.endpoint || age < 0 || age > connection.setupTimeoutMs || /(^|[-_.])latest($|[-_.])/i.test(receipt.immutableHindsightIdentity)) {
    throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED");
  }
  return connection;
}

function requireConnection(config: HindsightResolvedConfig): HindsightConnectionProjection {
  if (config.state !== "ready") throw hindsightError("HINDSIGHT_ENDPOINT_REJECTED");
  return config.projection;
}

function requireRevision(snapshot: HindsightSetupSnapshot, expected: number): HindsightSetupSnapshot {
  if (snapshot.revision !== expected) throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  return snapshot;
}

function requireIdle(snapshot: HindsightSetupSnapshot): void {
  if ((BUSY_SETUP_PHASES as readonly string[]).includes(snapshot.phase)) {
    throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  }
}

function persist(input: {
  deps: HindsightSetupDeps;
  current: HindsightSetupSnapshot;
  patch: Partial<HindsightSetupSnapshot>;
  updatedAt: string;
}): HindsightSetupSnapshot {
  const next = HindsightSetupSnapshotSchema.parse({ ...input.current, ...input.patch, banks: input.patch.banks ?? input.deps.bankRepo.list(), revision: input.current.revision + 1, updatedAt: input.updatedAt });
  return input.deps.connectionRepo.save(next, input.current.revision);
}

function persistFailure(input: {
  deps: HindsightSetupDeps;
  current: HindsightSetupSnapshot;
  error: ReturnType<typeof normalizeError>;
  updatedAt: string;
}): HindsightSetupSnapshot {
  return persist({ deps: input.deps, current: input.current, patch: { phase: "failed", latestError: input.error.projection() }, updatedAt: input.updatedAt });
}

function requireCanonicalLocal(deps: HindsightSetupDeps): void {
  if (deps.authorityMode() !== "canonical-local") throw hindsightError("HINDSIGHT_STATE_CONFLICT");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
