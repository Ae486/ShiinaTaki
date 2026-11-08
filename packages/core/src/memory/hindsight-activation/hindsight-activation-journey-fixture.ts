/**
 * INPUT:  a temp data dir with one Legacy Markdown entry, a file-backed SQLite on the full migration lineage, the activation
 *         transport double overlaid with the D77 application double, fixture config/secrets and a scripted Utility model
 * OUTPUT: createHindsightActivationJourney() -> the real composition (Legacy at boot), the real B3 setup service, the Local
 *         onboarding, Hindsight activation and Hindsight lifecycle services, the automatic lifecycle trigger (bound only
 *         when `automatic`) and one operation owner, with restart(bootId) reopening the same database as a new boot;
 *         `characters` adds native-side Banks for Characters no setup has provisioned; `backupRoute` gives the Stage 3
 *         backup producer a native route double (otherwise the production route over the transport double, whose native
 *         backup endpoint is off); never imported by production code
 * POS:    core/memory/hindsight-activation — test-only harness for the C03 and Stage 2c journeys through registered operations
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MockLanguageModelV4 } from "ai/test";
import type { MemoryOperation, MemoryOperationRequest, TimelineEntry } from "@taki/shared";
import { composeHindsightActivation } from "../../boot/hindsight-activation-boot.ts";
import { composeHindsightBackup } from "../../boot/hindsight-backup-boot.ts";
import { composeHindsightLifecycle } from "../../boot/hindsight-lifecycle-boot.ts";
import { createConfigSource, type ConfigSource } from "../../config/config-source.ts";
import { resolveHindsightConfig } from "../../config/hindsight-config.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createSummaryRepo } from "../../db/summary-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createHindsightActivationTransport, type HindsightActivationTransport } from "../../testing/hindsight-activation-transport.ts";
import { createNativeFixtureClient, hindsightApplicationClientOverlay, hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { failingGenerateModel } from "../../testing/mock-language-model.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import type { HindsightNativeBackupRoute } from "../hindsight-backup/hindsight-backup-route.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { createHindsightCompatibilityService } from "../hindsight/hindsight-compatibility-service.ts";
import { curatorTestBank } from "../hindsight/hindsight-policy-curator-fixtures.ts";
import { readHindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { createHindsightConnectionSecret } from "../hindsight/hindsight-secret-refs.ts";
import { createHindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import { loadTakiBankTemplate } from "../hindsight/taki-bank-template-v1.ts";
import { createHindsightLifecycleTrigger } from "../hindsight-lifecycle/hindsight-lifecycle-trigger.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { legacyEntry, PROFILE_ENTRY } from "../legacy-migration/legacy-migration-fixture.ts";
import { createLocalOnboardingService } from "../local-onboarding/local-onboarding-service.ts";
import { readLocalOnboardingStatus } from "../local-onboarding/local-onboarding-status.ts";
import { readMemoryAuthorityStatus } from "../operations/memory-authority-status.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { composeMemoryRuntime } from "../runtime-composition.ts";
import { baselineRecords } from "./hindsight-activation-fixture.ts";
import { readHindsightActivationStatus } from "./hindsight-activation-status.ts";

export const JOURNEY_CHARACTER = "taki";
const ENDPOINT = "http://127.0.0.1:18481";

export function createHindsightActivationJourney(options: {
  model?: MockLanguageModelV4; characters?: string[]; automatic?: boolean; backupRoute?: HindsightNativeBackupRoute; characterFact?: string;
} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-hindsight-journey-"));
  const workspaceRoot = join(dataDir, "workspace");
  const entry = join(workspaceRoot, PROFILE_ENTRY);
  mkdirSync(dirname(entry), { recursive: true }); writeFileSync(entry, legacyEntry("profile"));
  const model = options.model ?? failingGenerateModel(new Error("journey forbids unexpected Utility model calls"));
  const { logger, records: logs } = createCaptureLogger();
  const secrets = hindsightFixtureSecrets();
  const bindings = hindsightBankBindings(JOURNEY_CHARACTER);
  // Extra Characters exist natively (empty, unowned) but no setup has written their B3 rows yet.
  const extra = (options.characters ?? []).map((characterId) => ({ characterId, binding: hindsightBankBindings(characterId)[1] }));
  const native = [...bindings, ...extra.map((entry) => entry.binding)];
  const transport = createHindsightActivationTransport({ apiKey: secrets.state.value!, endpoint: ENDPOINT,
    banks: Object.fromEntries(native.map((binding) => [binding.externalBankId, baselineRecords(binding.externalBankId, loadTakiBankTemplate("taki-bank-v1", binding.scope))])) });
  const application = hindsightApplicationClientOverlay([...bindings.map((binding) => curatorTestBank({ bankId: binding.externalBankId,
    ...(binding.scope === "character" ? { characterId: JOURNEY_CHARACTER,
      ...(options.characterFact ? { memories: [{ id: "memory-a", text: options.characterFact }] } : {}) } : {}) })),
  ...extra.map((entry) => curatorTestBank({ bankId: entry.binding.externalBankId, characterId: entry.characterId, memories: [] }))]);
  // One client answers both the D78 activation routes (transport double) and the D77 application methods (in-memory overlay).
  const nativeClient = createNativeFixtureClient({ control: application.control, calls: application.calls,
    secrets: secrets.catalog, requireBank: application.requireBank });
  const client: HindsightClient = { ...transport.client, ...application.overlay,
    ...(options.characterFact ? { recallNative: nativeClient.recallNative } : {}) };
  const boot = { dataDir, workspaceRoot, model, logger, logs, secrets, transport, application, client, bindings, automatic: options.automatic ?? false,
    backupRoute: options.backupRoute };
  let session = openSession(boot, "boot-a");
  return {
    ...boot,
    get session() { return session; },
    /** Simulates a Core restart: every owner stops, the database closes, and the same files reopen under a new boot id. */
    restart: async (bootId: string) => { await session.stop(); session = openSession(boot, bootId); return session; },
    close: async () => { await session.stop(); rmTempDir(dataDir); },
  };
}
export type HindsightActivationJourney = ReturnType<typeof createHindsightActivationJourney>;
export type JourneySession = ReturnType<typeof openSession>;

interface Boot {
  dataDir: string; workspaceRoot: string; model: MockLanguageModelV4; logger: ReturnType<typeof createCaptureLogger>["logger"];
  secrets: ReturnType<typeof hindsightFixtureSecrets>; transport: HindsightActivationTransport; client: HindsightClient; automatic: boolean;
  backupRoute?: HindsightNativeBackupRoute;
}

function openSession(boot: Boot, bootId: string) {
  const db = openDatabase({ path: join(boot.dataDir, "state.db"), migrations: MIGRATIONS });
  const config = createConfigRepo(db); const source = createConfigSource({ env: {}, repo: config });
  config.upsert("TAKI_HINDSIGHT_ENABLED", true); config.upsert("TAKI_HINDSIGHT_ENDPOINT", ENDPOINT);
  const timeline = createTimelineRepo(db);
  const trigger = createHindsightLifecycleTrigger({ db, logger: boot.logger });
  const runtime = composeMemoryRuntime({ db, dataDir: boot.dataDir, promptDir: join(boot.dataDir, "prompt"), model: boot.model, timeline, bootId,
    windowStart: () => 1, summaries: createSummaryRepo(db), estimatedTokens: () => 0, budget: () => 100_000,
    compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger: boot.logger, hindsight: { source, secrets: boot.secrets.catalog, client: boot.client },
    onHindsightUnavailable: trigger.onUnavailable });
  runtime.start();
  const operationRepo = createMemoryOperationRepo(db);
  const secret = createHindsightConnectionSecret(boot.secrets.catalog);
  const setup = createHindsightSetupService({ config: () => resolveHindsightConfig(source), secret, client: () => boot.client,
    compatibility: createHindsightCompatibilityService(), connectionRepo: createHindsightConnectionRepo(db), bankRepo: createHindsightBankSetupRepo(db),
    authorityMode: () => readMemoryAuthoritySelection(db).mode, activationOpen: () => operationRepo.activeInFamily("hindsight-activation") !== undefined,
    wait: async () => undefined });
  const local = createLocalOnboardingService({ db, workspaceRoot: boot.workspaceRoot, runner: runtime.migrationRunner, runtime, owner: bootId, onChanged: () => undefined });
  const activation = composeHindsightActivation({ db, config: source, secrets: boot.secrets.catalog, setup, runtime, logger: boot.logger, client: boot.client });
  const lifecycle = composeHindsightLifecycle({ db, config: source, secrets: boot.secrets.catalog, runtime, logger: boot.logger, client: boot.client });
  const backup = openBackup(boot, db, source);
  const changes: MemoryOperation[] = [];
  const operations = createMemoryOperationService({ db, live: runtime.operations, setup, local, hindsight: activation, lifecycle, backup, bootId,
    logger: boot.logger, onChanged: (operation) => changes.push(operation) });
  if (boot.automatic) trigger.bind({ lifecycle, operations });
  const settled = async (request: MemoryOperationRequest): Promise<MemoryOperation> => {
    const admitted = operations.submit(request);
    await operations.stop();
    return operations.status(admitted.operationId);
  };
  const chat = (user: string, assistant: string, characterId = JOURNEY_CHARACTER): TimelineEntry[] => {
    const entries = [timeline.append({ characterId, role: "user", content: user }), timeline.append({ characterId, role: "assistant", content: assistant })];
    runtime.recordPrimaryCommitted({ characterId, entries });
    return entries;
  };
  return {
    bootId, db, config, source, timeline, runtime, setup, local, activation, lifecycle, backup, trigger, operations, changes, settled, chat,
    activationStatus: () => readHindsightActivationStatus({ service: activation, operations }),
    onboardingStatus: () => readLocalOnboardingStatus({ local, operations }),
    authorityStatus: () => readMemoryAuthorityStatus({ db, live: runtime.operations, binding: runtime.bindingSnapshot,
      hindsightBinding: runtime.hindsightBindingSnapshot, setup, operations,
      liveConnection: () => readHindsightLiveConnection({ config: source, secrets: boot.secrets.catalog }), lifecycle, backup }),
    stop: async () => {
      await Promise.all([local.stop(), activation.stop(), lifecycle.stop(), backup.stop()]);
      await runtime.stop().catch(() => undefined);
      await operations.stop();
      db.close();
    },
  };
}

function openBackup(boot: Boot, db: Database, config: ConfigSource) {
  return composeHindsightBackup({ db, dataDir: boot.dataDir, config, secrets: { catalog: boot.secrets.catalog, storeId: "journey-host" },
    logger: boot.logger, route: boot.backupRoute, client: boot.client });
}

/** Legacy -> Local through the registered S2a kinds; returns the committed Local epoch. */
export async function onboardLocal(session: JourneySession): Promise<string> {
  const preview = await session.local.preview();
  const prepared = await session.settled({ kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId } });
  if (prepared.state !== "completed" || prepared.producer?.kind !== "local") throw new Error(`Local prepare did not complete: ${prepared.state}/${prepared.errorCode}`);
  const activated = await session.settled({ kind: "local.onboard.activate", runId: prepared.producer.runId });
  if (activated.state !== "completed") throw new Error(`Local activate did not complete: ${activated.state}/${activated.errorCode}`);
  return readMemoryAuthoritySelection(session.db).epochId!;
}

/** B3 through the registered setup kinds against the transport double; returns the configured revision. */
export async function configureHindsight(session: JourneySession): Promise<number> {
  const validated = await session.settled({ kind: "setup.validate", expectedRevision: session.setup.status().revision });
  if (validated.state !== "completed") throw new Error(`setup.validate did not complete: ${validated.errorCode}`);
  const applied = await session.settled({ kind: "setup.apply", expectedRevision: session.setup.status().revision, characterId: JOURNEY_CHARACTER });
  if (applied.state !== "completed" || session.setup.status().phase !== "configured") throw new Error(`setup.apply did not configure: ${applied.errorCode}`);
  return session.setup.status().revision;
}

/** The chat-tool options every captured Run tool call needs. */
export const TOOL_OPTIONS = { toolCallId: "journey-tool", messages: [], context: undefined };
