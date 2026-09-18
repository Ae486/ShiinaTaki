/**
 * INPUT:  one private copied database, its owned restored endpoint, and the actual configured model slots
 * OUTPUT: authenticated production clients, real model/subsystem instances, and content-free progress
 * POS:    task-only actual-data acceptance; original storage and model credentials never enter reports
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { createConfigSource } from "../../../../../packages/core/src/config/config-source.ts";
import { loadMemoryConfig } from "../../../../../packages/core/src/config/memory-config.ts";
import { loadProviderConfig } from "../../../../../packages/core/src/config/provider-config.ts";
import { createModels } from "../../../../../packages/core/src/config/provider-factory.ts";
import { loadUtilityConfig } from "../../../../../packages/core/src/config/utility-config.ts";
import { createConfigRepo } from "../../../../../packages/core/src/db/config-repo.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { createTimelineRepo } from "../../../../../packages/core/src/db/timeline-repo.ts";
import { createSecretCatalogService } from "../../../../../packages/core/src/secrets/secret-catalog-service.ts";
import { createCaptureLogger } from "../../../../../packages/core/src/testing/capture-logger.ts";
import { createUtilitySlot } from "../../../../../packages/core/src/memory/utility-slot.ts";
import { createHindsightMemorySubsystem } from "../../../../../packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { hindsightHttpTransport } from "../../../../../packages/core/src/memory/hindsight/hindsight-http-transport.ts";
import { HINDSIGHT_SECRET_REFS } from "../../../../../packages/core/src/memory/hindsight/hindsight-secret-refs.ts";
import { readMemoryAuthoritySelection } from "../../../../../packages/core/src/memory/legacy-migration/legacy-activation-repo.ts";

export const ROOT = resolve(process.env.TAKI_D77_ACCEPTANCE_ROOT
  ?? "H:/TakiAgent/.trellis/.runtime/d77-acceptance/9e41c8d27fa0");
assert.ok([
  "H:/TakiAgent/.trellis/.runtime/d77-acceptance/9e41c8d27fa0",
  "H:/TakiAgent/.trellis/.runtime/d77-api-acceptance/ca744d0f8a27",
].map((path) => resolve(path)).includes(ROOT), "D77_ACCEPTANCE_ROOT_REFUSED");
export const ORIGINAL_RUN = "654131f0175a";
export const at = () => new Date().toISOString();
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const faults = { offline: false, loseNextNativeAck: false, loseNextApplicationAck: false };
export const traffic = { requests: 0, nativeDispatches: 0, nativeWrites: 0, applicationCommits: 0, nativeAckLoss: 0, applicationAckLoss: 0 };
export const controller = new AbortController();

export function event(code: string, detail: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: at(), code, ...detail });
  appendFileSync(join(ROOT, "acceptance-events.jsonl"), `${line}\n`, "utf8");
  process.stdout.write(`${line}\n`);
}
export function privateJson(name: string, value: unknown): void {
  assert.match(name, /^[a-z0-9-]+\.json$/);
  writeFileSync(join(ROOT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
export function admittedArguments() {
  const [mode, path, endpoint, extra] = process.argv.slice(2);
  assert.equal(mode, "run"); assert.equal(extra, undefined);
  assert.equal(process.env.TAKI_D78_REAL_DATA, "1");
  assert.equal(resolve(path ?? ""), join(ROOT, "validation.sqlite"));
  assert.equal(endpoint, process.env.TAKI_D78_OWNED_ENDPOINT);
  assert.ok(endpoint && new URL(endpoint).hostname === "127.0.0.1");
  assert.ok(process.env.TAKI_D78_API_KEY && process.env.TAKI_D78_CONSUMER_ID);
  for (let current = ROOT; ; current = dirname(current)) {
    assert.equal(lstatSync(current).isSymbolicLink(), false);
    if (dirname(current) === current) break;
  }
  return { path: join(ROOT, "validation.sqlite"), endpoint };
}
export interface AcceptanceHttpObservation {
  category: "native-recall" | "guarded-reflect" | "hydration" | "body-part" | "other";
  elapsedMs: number;
  status: number | null;
}
export interface AcceptanceRuntimeOptions {
  requestTimeoutMs?: number;
  onHttp?: (value: AcceptanceHttpObservation) => void;
  curatorMaxSteps?: number;
  curatorTimeoutMs?: number;
}
export function makeClient(endpoint: string, onHttp?: AcceptanceRuntimeOptions["onHttp"]) {
  return createHindsightClient({ endpoint, resolveApiKey: () => process.env.TAKI_D78_API_KEY ?? null,
    transport: async (address, init, maxResponseBytes) => {
      const url = new URL(address); assert.equal(url.origin, endpoint);
      if (faults.offline) throw new Error("owned acceptance outage");
      traffic.requests++;
      const started = performance.now(); let status: number | null = null;
      const nativeWrite = init?.method === "POST" && url.pathname.endsWith("/retains")
        || init?.method === "PATCH" && url.pathname.includes("/memories/");
      // A failed response does not prove that a remote write was never sent.
      // Keep dispatch evidence separate from the historical response counter.
      const method = (init?.method ?? "GET").toUpperCase();
      const nativeReadPost = method === "POST" && ["/memories/recall", "/reflect", "/health/llm", "/snapshots"]
        .some((suffix) => url.pathname.endsWith(suffix));
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)
        && !url.pathname.includes("/application-state/") && !nativeReadPost) traffic.nativeDispatches++;
      try {
        const response = await hindsightHttpTransport(address, init, { maxBytes: maxResponseBytes, responseStatuses: [503] });
        status = response.status;
        if (nativeWrite) {
          traffic.nativeWrites++;
          if (faults.loseNextNativeAck && response.status >= 200 && response.status < 300) {
            faults.loseNextNativeAck = false; faults.offline = true; traffic.nativeAckLoss++;
            throw new Error("owned lost native response");
          }
        }
        if (init?.method === "POST" && url.pathname.endsWith("/commits")) {
          traffic.applicationCommits++;
          if (faults.loseNextApplicationAck && response.status >= 200 && response.status < 300) {
            faults.loseNextApplicationAck = false; faults.offline = true; traffic.applicationAckLoss++;
            throw new Error("owned lost application response");
          }
        }
        return response;
      } finally {
        const category = url.pathname.endsWith("/memories/recall") ? "native-recall"
          : url.pathname.endsWith("/application-state/reflect") ? "guarded-reflect"
            : url.pathname.includes("/hydrate") ? "hydration" : url.pathname.includes("/parts/") ? "body-part" : "other";
        onHttp?.({ category, elapsedMs: performance.now() - started, status });
      }
    } });
}

export async function openRuntime(path: string, endpoint: string, options: AcceptanceRuntimeOptions = {}) {
  assert.equal(dirname(path), ROOT);
  const db = openDatabase({ path, migrations: MIGRATIONS });
  const selection = readMemoryAuthoritySelection(db); assert.equal(selection.mode, "hindsight");
  assert.ok(selection.epochId);
  const { logger } = createCaptureLogger();
  // Copy only actual model-slot configuration out of the launch file. The
  // isolated endpoint/data root cannot be overridden by original launch knobs.
  const launch = parseEnv(readFileSync(resolve("H:/TakiAgent/.env.local"), "utf8"));
  const modelEnv = Object.fromEntries(Object.entries(launch).filter(([key]) => /^TAKI_(PROVIDER|UTILITY)_(BASE_URL|API_KEY|MODEL)$/.test(key)));
  const source = createConfigSource({ repo: createConfigRepo(db), env: { ...modelEnv,
    TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: endpoint,
    TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: String(options.requestTimeoutMs ?? 120000),
    TAKI_MEMORY_TIDY_REPORT_CAP: "3", TAKI_MEMORY_TIDY_MAX_STEPS: String(options.curatorMaxSteps ?? 4),
    ...(options.curatorTimeoutMs === undefined ? {} : { TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: String(options.curatorTimeoutMs) }) } });
  const env = source.env(); const provider = loadProviderConfig(env); const utilityConfig = loadUtilityConfig(env);
  assert.equal(new URL(provider.baseUrl).origin, "https://api.deepseek.com");
  if (utilityConfig) assert.equal(new URL(utilityConfig.baseUrl).origin, "https://api.deepseek.com");
  const models = createModels({ provider, vision: null, includeUsage: true });
  const utility = createUtilitySlot({ mainModel: models.model, config: utilityConfig, logger });
  const keyPath = join(ROOT, "acceptance-master.key");
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
  const master = readFileSync(keyPath); assert.equal(master.length, 32);
  const secrets = await createSecretCatalogService({ filePath: join(ROOT, "acceptance-secrets.bin"),
    storeId: "74ce7ed5-3810-4dd7-9617-04f2c3869a15", logger,
    keySource: { kind: "credentials-directory", canCreate: false, read: () => master,
      create: () => { throw new Error("acceptance master key already exists"); } } });
  if (!secrets.resolve(HINDSIGHT_SECRET_REFS.connectionApiKey)) secrets.set(HINDSIGHT_SECRET_REFS.connectionApiKey, process.env.TAKI_D78_API_KEY!);
  const timeline = createTimelineRepo(db); const client = makeClient(endpoint, options.onHttp);
  const subsystem = createHindsightMemorySubsystem({ db, epochId: selection.epochId,
    config: loadMemoryConfig(env), source, secrets, timeline, utility, logger, client });
  const banks = createHindsightBankSetupRepo(db).list();
  const character = banks.find((bank) => bank.scope === "character"); assert.ok(character);
  return { db, path, endpoint, epochId: selection.epochId, subsystem, timeline, utility, models, logger, client, banks,
    characterId: character.canonicalIdentity.slice("character:".length),
    close: async () => { await subsystem.stop(); await utility.stop(); db.close(); } };
}
export type AcceptanceRuntime = Awaited<ReturnType<typeof openRuntime>>;
export function call(runtime: AcceptanceRuntime, requestId: string = randomUUID()) {
  return { authorityEpochId: runtime.epochId, requestId, actor: "foreground-agent" as const, signal: controller.signal };
}
export async function sync(runtime: AcceptanceRuntime, bankId: string, timeoutMs = 20 * 60_000) {
  await runtime.subsystem.state.service.synchronize({ bankId, context: { timeoutMs, signal: controller.signal } });
}
export function scope(runtime: AcceptanceRuntime, bankId: string) {
  const checkpoint = runtime.subsystem.state.replica.checkpoint(bankId); assert.ok(checkpoint);
  return { bankId, namespace: checkpoint.namespace };
}
