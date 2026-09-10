/**
 * INPUT:  an explicit owned HTTP endpoint and a transient API key supplied by the owner process
 * OUTPUT: real B3 setup plus D78 clients with observable, persisted acknowledgement-loss boundaries
 * POS:    validation transport consumer; model decisions and native results are never synthesized
 */
import { HindsightConnectionProjectionSchema } from "../../../../../packages/shared/src/hindsight-connection-schema.ts";
import type { HindsightSetupSnapshot } from "../../../../../packages/shared/src/index.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { requireHindsightLocalCoverageBanks } from "../../../../../packages/core/src/db/hindsight-local-bank-binding.ts";
import type { Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { createHindsightClient, type HindsightCallContext, type HindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { createHindsightCompatibilityService } from "../../../../../packages/core/src/memory/hindsight/hindsight-compatibility-service.ts";
import type { HindsightCurrentStateClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-current-client.ts";
import { hindsightError } from "../../../../../packages/core/src/memory/hindsight/hindsight-errors.ts";
import { createHindsightSetupService } from "../../../../../packages/core/src/memory/hindsight/hindsight-setup-service.ts";
import { readMemoryAuthoritySelection } from "../../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";
import type { RealDataSession } from "./current-cutover-real-data-local.ts";
import { OWNED_RUN_ID, requireCondition, requireOwnedEndpoint } from "./current-cutover-real-data-state.ts";

export function createRealDataClient(session: RealDataSession, endpoint: string) {
  requireOwnedEndpoint(endpoint);
  requireCondition(session.state.endpoint === null || session.state.endpoint === endpoint, "REAL_DATA_TARGET_CHANGED");
  session.state.endpoint = endpoint;
  session.metadata.save();
  const base = withRunCancellation(createHindsightClient({ endpoint, resolveApiKey: resolveTemporaryKey }), session.controller.signal);
  const native = requireCurrentMethods(base);
  const current: HindsightCurrentStateClient = {
    ...native,
    transferCurrentState: async (input) => {
      session.assertLive();
      session.state.counters.transferDispatches++;
      session.metadata.save();
      const result = await native.transferCurrentState(input);
      session.assertLive();
      if (!("error" in result) && session.state.acknowledgements.import === "pending") {
        session.state.acknowledgements.import = "lost";
        session.state.acknowledgementIds.import = result.operation_id;
        session.metadata.save();
        session.metadata.report("REAL_DATA_IMPORT_ACK_LOST", { operationId: result.operation_id, resultHash: result.result_hash });
        throw hindsightError("HINDSIGHT_UNREACHABLE");
      }
      return result;
    },
    advanceCurrentVerification: async (input) => {
      session.assertLive();
      session.state.counters.verificationAdvances++;
      session.metadata.save();
      const result = await native.advanceCurrentVerification(input);
      session.assertLive();
      if (!("error" in result) && result.state === "complete" && session.state.acknowledgements.verification === "pending") {
        session.state.acknowledgements.verification = "lost";
        session.state.acknowledgementIds.verification = result.verification_id;
        session.metadata.save();
        session.metadata.report("REAL_DATA_VERIFICATION_ACK_LOST", { verificationId: result.verification_id,
          certificateHash: result.certificate?.certificate_hash });
        throw hindsightError("HINDSIGHT_UNREACHABLE");
      }
      return result;
    },
  };
  return { base, current };
}

/** B3 supplies its own setup signal; combine it with operator cancellation instead of replacing its deadline. */
export function withRunCancellation(client: HindsightClient, signal: AbortSignal): HindsightClient {
  const context = (input: HindsightCallContext) => ({ ...input,
    signal: input.signal ? AbortSignal.any([input.signal, signal]) : signal });
  return { ...client,
    health: (input) => client.health(context(input)),
    version: (input) => client.version(context(input)),
    compatibility: (input) => client.compatibility(context(input)),
    createOrUpdateBank: (bankId, input) => client.createOrUpdateBank(bankId, context(input)),
    importTemplate: (input) => client.importTemplate({ ...input, context: context(input.context) }),
    exportTemplate: (bankId, input) => client.exportTemplate(bankId, context(input)),
    bankLlmHealth: (bankId, input) => client.bankLlmHealth(bankId, context(input)),
    operationStatus: (bankId, operationId, input) => client.operationStatus(bankId, operationId, context(input)),
  };
}

/** Configuration is owned by the native test process; null overrides preserve its actual configured models. */
function connectionProjection(endpoint: string) {
  return HindsightConnectionProjectionSchema.parse({ enabled: true, deploymentMode: "existing-instance", endpoint,
    apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 120_000, setupTimeoutMs: 120_000,
    desiredTemplateRevision: "taki-bank-v1", model: { defaultProvider: null, defaultModel: null, retainModel: null,
      reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null,
      rerankerProvider: null, rerankerModel: null } });
}

export async function setupRealTarget(session: RealDataSession, input: { endpoint: string; client: HindsightClient }): Promise<HindsightSetupSnapshot> {
  session.stage = "B3_SETUP";
  recoverInterruptedSetup({ db: session.db, requireStoppedOwner: () => session.metadata.requireStoppedPriorRunner(),
    consumeStoppedOwner: (processId) => session.metadata.consumeStoppedPriorRunner(processId),
    report: (code, value) => session.metadata.report(code, value) });
  const connection = connectionProjection(input.endpoint);
  const service = createHindsightSetupService({ config: () => ({ state: "ready", projection: connection }),
    secret: { resolve: resolveTemporaryKey, marker: () => `owned-d78-real-data-${OWNED_RUN_ID}` },
    client: () => input.client, compatibility: createHindsightCompatibilityService(),
    connectionRepo: createHindsightConnectionRepo(session.db), bankRepo: createHindsightBankSetupRepo(session.db),
    authorityMode: () => readMemoryAuthoritySelection(session.db).mode });
  let setup = await service.validate({ expectedRevision: service.status().revision });
  requireCondition(setup.phase === "compatible" && setup.compatibility?.providerLineage,
    setup.latestError?.code ?? "REAL_DATA_B3_VALIDATION_FAILED");
  const lineage = setup.compatibility.providerLineage;
  requireCondition(session.state.providerLineage === null || session.state.providerLineage === lineage, "REAL_DATA_NATIVE_LINEAGE_CHANGED");
  session.state.providerLineage = lineage;
  session.metadata.save();
  for (const bank of session.capture.banks) {
    if (bank.scope.kind !== "character") continue;
    session.assertLive();
    setup = await service.setup({ expectedRevision: setup.revision, characterId: bank.scope.characterId });
    requireCondition(setup.phase === "configured", setup.latestError?.code ?? "REAL_DATA_B3_SETUP_FAILED");
  }
  session.assertLive();
  requireHindsightLocalCoverageBanks(session.db, { coverage: session.capture.manifest,
    nativeBankIds: setup.banks.map((bank) => bank.externalBankId) });
  session.metadata.report("REAL_DATA_B3_CONFIGURED", { revision: setup.revision, configFingerprint: setup.configFingerprint,
    providerLineage: lineage, verifiedBankCount: setup.banks.length, modelHealth: setup.modelHealth,
    banks: setup.banks.map((bank) => ({ bankId: bank.externalBankId, scope: bank.scope,
      templateDigest: bank.templateDigest, templateRevision: bank.templateRevision, status: bank.status })) });
  return setup;
}

/** The task copy is offline and exclusively locked; a stopped process proves interruption, never remote success. */
export function recoverInterruptedSetup(input: { db: Database; requireStoppedOwner: () => number;
  consumeStoppedOwner: (processId: number) => void;
  report: (code: string, value: Record<string, unknown>) => void }): void {
  const repo = createHindsightConnectionRepo(input.db);
  const current = repo.read(createHindsightBankSetupRepo(input.db).list());
  const inFlight = ["validating", "validating-templates", "initializing-banks", "applying-templates", "waiting-template-operations"];
  if (!inFlight.includes(current.phase)) return;
  const priorRunnerId = input.requireStoppedOwner();
  const recovered = repo.save({ ...current, revision: current.revision + 1, phase: "failed",
    latestError: hindsightError("HINDSIGHT_CANCELLED").projection(), updatedAt: new Date().toISOString() }, current.revision);
  input.report("REAL_DATA_B3_ATTEMPT_INTERRUPTED", { priorPhase: current.phase, priorRevision: current.revision,
    priorAttemptId: current.attemptId, priorRunnerId, revision: recovered.revision, recoveryReason: "stopped_runner",
    bankCount: current.banks.length, phase: recovered.phase });
  input.consumeStoppedOwner(priorRunnerId);
}

export function currentCallContext(session: RealDataSession) {
  return { signal: session.controller.signal, timeoutMs: resolveCurrentRequestTimeout(process.env.TAKI_D78_REQUEST_TIMEOUT_MS) };
}

export function resolveCurrentRequestTimeout(value: string | undefined): number {
  // Actual source batches can take tens of minutes. This is an explicit operator budget, not a latency guarantee
  // for the protocol's 10,000-record envelope; expiry remains an unknown remote outcome with the same durable IDs.
  const timeoutMs = value === undefined ? 3 * 60 * 60_000 : Number(value);
  requireCondition(Number.isSafeInteger(timeoutMs) && timeoutMs >= 120_000 && timeoutMs <= 24 * 60 * 60_000,
    "REAL_DATA_DEADLINE_INVALID");
  return timeoutMs;
}

function resolveTemporaryKey(): string | null {
  return process.env.TAKI_D78_API_KEY?.trim() || null;
}

function requireCurrentMethods(client: HindsightClient): HindsightClient & HindsightCurrentStateClient {
  const names: Array<keyof HindsightCurrentStateClient> = ["transferCurrentState", "currentTransferResult", "currentTransferPage",
    "prepareCurrentVerification", "advanceCurrentVerification", "currentVerification", "currentVerificationPage",
    "createCurrentSnapshot", "currentSnapshotPage"];
  requireCondition(names.every((name) => typeof client[name] === "function"), "REAL_DATA_D78_CLIENT_UNAVAILABLE");
  return client as HindsightClient & HindsightCurrentStateClient;
}
