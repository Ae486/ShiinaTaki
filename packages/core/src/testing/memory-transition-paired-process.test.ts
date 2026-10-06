import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import { W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "../config/config-source.ts";
import { resolveHindsightConfig } from "../config/hindsight-config.ts";
import { hindsightConnectionFingerprint } from "../memory/hindsight/hindsight-compatibility-service.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import { createNativeBackupRouteDouble } from "../memory/hindsight-backup/hindsight-backup-route-fixtures.ts";
import { operatorZip } from "../memory/hindsight-backup/hindsight-backup-harness.ts";
import { readHindsightBackupArchive } from "../memory/hindsight-backup/hindsight-backup-archive.ts";

it("stages and seals through real operation owners with actual fixture custody, then gates paired reopen", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
  const h = await createHealthyTransitionHarness({ aliases: true });
  const repo = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = resolve(repo, ".trellis/.runtime/stage4-w6-restore", `paired-process-${randomUUID()}`);
  const core = join(root, "core"); const keys = join(root, "keys");
  mkdirSync(core, { recursive: true }); mkdirSync(keys, { recursive: true });
  writeFileSync(join(keys, "taki-secret-catalog-master-key"), randomBytes(32), { flag: "wx" });
  const connectionEnv = { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481",
    TAKI_HINDSIGHT_DEPLOYMENT_MODE: "existing-instance", TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "60000", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "120000" };
  const env = { ...process.env, TAKI_CREDENTIALS_DIRECTORY: keys };
  const research = join(repo, ".trellis/tasks/09-29-hindsight-transitions-emergency/research");
  const run = (script: string, args: string[]) => {
    const result = spawnSync(process.execPath, [join(research, script), ...args], { cwd: repo, env, encoding: "utf8", timeout: 25_000, windowsHide: true });
    expect(result.status, result.stderr + result.stdout).toBe(0);
  };
  try {
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      expect(h.owner.status(operation.operationId).state).toBe("completed");
    }
    await h.stop();
    const config = resolveHindsightConfig(createConfigSource({ repo: createConfigRepo(h.db), env: connectionEnv }));
    if (config.state !== "ready") throw new Error("owned test configuration unavailable");
    // Adopt this test's actual W5 fixture catalog marker in the mutable reviewed row before capturing the source.
    const marker = createHash("sha256").update("ok:true:1:2026-10-03T00:00:00.000Z").digest("hex");
    h.db.prepare("UPDATE hindsight_connection_state SET config_fingerprint=:value WHERE singleton=1")
      .run({ value: hindsightConnectionFingerprint(config.projection, marker) });
    const dbPath = join(core, "taki.db"); await h.db.backupTo(dbPath);
    const plan = { ownedRoot: root, coreStopped: true, coreDataDir: core, coreDbPath: dbPath,
      expectedCoreSha256: createHash("sha256").update(readFileSync(dbPath)).digest("hex"), initializeOwnedFixtureCustody: true,
      connectionEnv, nativeResultPath: join(root, "native-result.json"), nativeArchivePath: join(root, "native.zip") };
    const planPath = join(root, "plan.json"); writeFileSync(planPath, JSON.stringify(plan));
    run("w6-paired-core-capture.mjs", ["--run-owned-pair", "--plan", planPath, "--phase", "stage"]);
    const stage = JSON.parse(readFileSync(join(root, "stage-result.json"), "utf8"));
    expect(stage).toMatchObject({ completed: true, stopped: true, custody: "owned-fixture-http-only", counters: { nativeCalls: 0, transportCalls: 0, modelCalls: 0 } });
    const store = createHindsightBackupStore(core); const staged = (await store.readStaged(stage.backupId))!;
    // This transport fixture proves the Core route-b protocol. Current real Native restore is a separate owned-PG gate.
    const route = createNativeBackupRouteDouble({ providerLineage: staged.core.authority.providerLineageId,
      receipts: new Set(staged.request.operationIds), banks: new Map(staged.core.banks.map((bank) => [bank.nativeBankId,
        { bankGeneration: bank.bankGeneration!, currentCursor: bank.core.replicaCursor!, application:
          { nativeCursor: bank.core.applicationNativeCursor!, stateCursor: bank.core.applicationStateCursor! } }])) });
    writeFileSync(plan.nativeArchivePath, await operatorZip({ root: store.root, backupId: stage.backupId, route }));
    const archive = await readHindsightBackupArchive(plan.nativeArchivePath);
    writeFileSync(plan.nativeResultPath, JSON.stringify({ completed: true, sourceUnchanged: true, backupId: stage.backupId,
      sourceSchema: "public", targetSchema: `w6_restore_${"b".repeat(32)}`, native: archive.proof }));
    run("w6-paired-core-capture.mjs", ["--run-owned-pair", "--plan", planPath, "--phase", "seal"]);
    const seal = JSON.parse(readFileSync(join(root, "seal-result.json"), "utf8"));
    expect(seal).toMatchObject({ completed: true, stopped: true, backupId: stage.backupId, coreSha256: stage.coreSha256 });
    const preflightPath = join(root, "preflight-plan.json"); writeFileSync(preflightPath, JSON.stringify({ ownedRoot: root, coreStopped: true,
      pairDir: seal.pairDir, nativeResultPath: plan.nativeResultPath, nativeArchivePath: plan.nativeArchivePath, custodyDataDir: core }));
    run("w6-paired-core-restore.mjs", ["--run-owned-preflight", "--plan", preflightPath]);
    expect(JSON.parse(readFileSync(join(root, "core-restore-preflight.json"), "utf8"))).toMatchObject({ completed: true, inputsUnchanged: true, credentialHealth: "ok" });
  } finally { await h.close(); vi.useRealTimers(); }
}, 90_000);
