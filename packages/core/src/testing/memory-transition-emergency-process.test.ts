import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import { W3_AT } from "./memory-transition-candidate-fixtures.ts";
import { composeEmergencyFixture } from "./memory-transition-emergency-service-fixtures.ts";
import * as candidates from "../db/memory-transition-emergency-candidate.ts";
import { readEmergencyCapture, readEmergencyIncident } from "../db/memory-transition-emergency-repo.ts";
import { readTransitionReceipt } from "../db/memory-transition-evidence-repo.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readVerifiedEmergencyPublication } from "../db/memory-transition-emergency-publication.ts";
import { verifyInstalledTransitionLocal } from "../db/memory-transition-publication-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import * as healthyCandidates from "../memory/transitions/transition-healthy-candidate.ts";

describe("actual driver protocol on synthetic stopped Core data", () => {
  it.each(["fresh", "sealed-recovery", "committed-recovery"] as const)("finishes %s and restarts the same receipt in separate supervised Node processes", async (mode) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
    const h = await createHealthyTransitionHarness({ aliases: true });
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const root = resolve(repo, ".trellis/.runtime/stage4-w6", `synthetic-${randomUUID()}`);
    const core = join(root, "core"); const history = join(root, "emergency-history", randomUUID());
    mkdirSync(core, { recursive: true }); mkdirSync(history, { recursive: true });
    let emergency: ReturnType<typeof composeEmergencyFixture> | undefined;
    try {
      const candidateErrors: string[] = []; const prepare = healthyCandidates.prepareHealthyTransitionCandidate;
      vi.spyOn(healthyCandidates, "prepareHealthyTransitionCandidate").mockImplementation(async (input) => {
        try { return await prepare(input); } catch (error) { candidateErrors.push(String(error)); throw error; }
      });
      for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
        const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(h.owner.status(operation.operationId).state, JSON.stringify({ kind,
          status: h.owner.status(operation.operationId), logs: h.records, candidateErrors })).toBe("completed");
        if (mode === "committed-recovery" && kind === "transition.return-local") {
          const epochId = readMemoryAuthoritySelection(h.db).epochId!;
          const maintenance = createCanonicalMemoryMaintenanceRepo(h.db);
          const record = maintenance.list({ epochId, characterId: "taki" }).find((row) => row.unit.bankId === "bank-taki" && row.unit.state === "valid")!;
          maintenance.policyEdit({ epochId, bankId: record.unit.bankId, memoryId: record.unit.memoryId, characterId: "taki",
            expectedRevision: record.unit.revision, requestId: randomUUID(), now: W3_AT,
            patch: { layerId: "intentions", retention: { kind: "expiring", expiresAt: "2026-10-01T00:01:00.000Z" } } });
        }
      }
      let original: { transitionId: string; originalOperationId: string; originalOperationHash: string;
        captureId: string; incidentId: string; incidentHash: string } | undefined;
      let evidencePath: string | undefined; let committedReceipt: string | undefined;
      if (mode !== "fresh") {
        emergency = composeEmergencyFixture(h);
        let installation: Record<string, unknown> | undefined;
        if (mode === "sealed-recovery") {
          vi.spyOn(candidates, "prepareEmergencyCandidate").mockImplementationOnce(() => { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); });
        } else {
          vi.setSystemTime("2026-10-01T00:02:00.000Z");
          const bind = h.runtime.transitions.bind;
          vi.spyOn(h.runtime.transitions, "bind").mockImplementationOnce(async (id) => {
            const receipt = readTransitionReceipt(h.db, id)!;
            const publication = readVerifiedEmergencyPublication(h.db, receipt.receiptId);
            const candidate = candidates.readVerifiedEmergencyCandidate(h.db, publication.candidateId);
            verifyInstalledTransitionLocal(h.db, candidate);
            installation = { candidateId: candidate.candidateId, stateHash: candidate.stateHash, mappingHash: candidate.mappingHash,
              sources: candidate.state.sources.length, records: candidate.state.records.length, banks: candidate.state.banks.length,
              checkedBeforeLocalStartup: true };
            await bind(id); // Starts the real Local sweeper and produces a real retention receipt.
            throw new Error("owned lost bind completion");
          });
        }
        const failed = emergency.emergencyOwner.submit(await emergency.emergencyRequest()); await emergency.emergencyOwner.stop();
        expect(emergency.emergencyOwner.status(failed.operationId).state).toBe("outcome_unknown");
        const transitionId = failed.producer!.kind === "transition" ? failed.producer!.transitionId : "";
        const capture = readEmergencyCapture(h.db, transitionId)!; const incident = readEmergencyIncident(h.db, transitionId)!;
        const receipt = readTransitionReceipt(h.db, transitionId);
        expect(!!receipt).toBe(mode === "committed-recovery");
        committedReceipt = receipt?.receiptId;
        if (receipt) {
          expect(h.db.prepare("SELECT count(*) n FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch")
            .get({ epoch: receipt.newEpochId })!.n).toBe(1);
          evidencePath = join(root, "emergency-history", "original-failure", "driver-result.json");
          mkdirSync(join(root, "emergency-history", "original-failure"));
          const status = emergency.emergencyOwner.status(failed.operationId);
          writeFileSync(evidencePath, JSON.stringify({ version: 1, phase: "emergency", executed: true, completed: false,
            operation: { operationId: status.operationId, state: status.state, result: status.result }, installation,
            phases: [{ name: "exact-installation-verified" }],
            counters: { nativeCalls: 0, transportCalls: 0, modelCalls: 0, nativeInFlight: 0, modelInFlight: 0 } }));
        }
        original = { transitionId, originalOperationId: failed.operationId,
          originalOperationHash: transitionLocalHash(emergency.emergencyOwner.status(failed.operationId)),
          captureId: capture.captureId, incidentId: incident.incidentId, incidentHash: transitionLocalHash(incident) };
        await emergency.stopEmergency(); vi.restoreAllMocks();
        cpSync(join(h.dataDir, "backups"), join(core, "backups"), { recursive: true, errorOnExist: true, force: false });
      }
      await h.stop(); await h.db.backupTo(join(core, "taki.db"));
      const driver = join(repo, ".trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-owned-emergency-driver.mjs");
      if (evidencePath && original) {
        const prior = JSON.parse(readFileSync(evidencePath, "utf8"));
        const stoppedHash = () => createHash("sha256").update(readFileSync(join(core, "taki.db"))).digest("hex");
        const before = stoppedHash();
        for (const fault of ["missing", "foreign-path", "wrong-receipt", "wrong-candidate", "missing-installation", "changed-operation"] as const) {
          const evidence = structuredClone(prior);
          if (fault === "wrong-receipt") evidence.operation.result.receiptId = "0".repeat(64);
          if (fault === "wrong-candidate") evidence.installation.candidateId = randomUUID();
          if (fault === "missing-installation") evidence.phases = [];
          if (fault === "changed-operation") evidence.operation.result.runtime = "unavailable";
          const invalidPath = join(fault === "foreign-path" ? root : history, `${fault}-evidence.json`);
          writeFileSync(invalidPath, JSON.stringify(evidence));
          const resultPath = join(history, `${fault}-refusal.json`);
          const run = spawnSync(process.execPath, [driver, "--run-owned-copy", "--core-data-dir", core,
            "--core-db-path", join(core, "taki.db"), "--result-path", resultPath, "--phase", "emergency",
            "--recovery-transition-id", original.transitionId, ...(fault === "missing" ? [] : ["--recovery-evidence-path", invalidPath])],
          { cwd: repo, encoding: "utf8", timeout: 45_000, windowsHide: true });
          expect(run.status, `${fault}: ${run.stderr}`).toBe(1);
          if (fault === "foreign-path") expect(run.stderr).toContain("W6_RECOVERY_EVIDENCE_OWNERSHIP_REQUIRED");
          else {
            const result = JSON.parse(readFileSync(resultPath, "utf8"));
            expect(result.completed).toBe(false);
            expect(result.phases.map((row: { name: string }) => row.name)).not.toContain("offline-preview");
          }
          expect(existsSync(join(core, "w6-emergency-checkpoint.json"))).toBe(false);
          expect(stoppedHash(), fault).toBe(before);
        }
      }
      const outcomes = [];
      for (const phase of ["emergency", "restart"]) {
        if (phase === "restart" && evidencePath) {
          const checkpointPath = join(core, "w6-emergency-checkpoint.json");
          const originalCheckpoint = readFileSync(checkpointPath, "utf8"); const originalHistory = readFileSync(evidencePath, "utf8");
          const stoppedHash = createHash("sha256").update(readFileSync(join(core, "taki.db"))).digest("hex");
          for (const fault of ["unknown-operation", "history-bytes"] as const) {
            try {
              if (fault === "unknown-operation") {
                const checkpoint = JSON.parse(originalCheckpoint);
                checkpoint.recovery.preservedUnknownOperations[0].hash = "0".repeat(64);
                writeFileSync(checkpointPath, JSON.stringify(checkpoint));
              } else writeFileSync(evidencePath, originalHistory + "\n");
              const refusedPath = join(history, `restart-${fault}-refused.json`);
              const run = spawnSync(process.execPath, [driver, "--run-owned-copy", "--core-data-dir", core,
                "--core-db-path", join(core, "taki.db"), "--result-path", refusedPath, "--phase", "restart"],
              { cwd: repo, encoding: "utf8", timeout: 45_000, windowsHide: true });
              expect(run.status, run.stderr).toBe(1);
              const refused = JSON.parse(readFileSync(refusedPath, "utf8"));
              expect(refused.error.code).toBe(fault === "unknown-operation" ? "W6_UNKNOWN_HISTORY_CHANGED" : "W6_ORIGINAL_INSTALLATION_HISTORY_CHANGED");
              expect(createHash("sha256").update(readFileSync(join(core, "taki.db"))).digest("hex")).toBe(stoppedHash);
            } finally { writeFileSync(checkpointPath, originalCheckpoint); writeFileSync(evidencePath, originalHistory); }
          }
        }
        const resultPath = join(history, `${phase}.json`);
        const run = spawnSync(process.execPath, [driver, "--run-owned-copy", "--core-data-dir", core,
          "--core-db-path", join(core, "taki.db"), "--result-path", resultPath, "--phase", phase,
          ...(phase === "emergency" && original ? ["--recovery-transition-id", original.transitionId] : []),
          ...(phase === "emergency" && evidencePath ? ["--recovery-evidence-path", evidencePath] : [])],
        { cwd: repo, encoding: "utf8", timeout: 45_000, windowsHide: true });
        const result = JSON.parse(readFileSync(resultPath, "utf8"));
        expect({ status: run.status, error: result.error, diagnostics: result.diagnostics }, run.stderr).toMatchObject({ status: 0 });
        expect(result.completed).toBe(true); expect(result.additionalDispatch).toEqual({ native: 0, transport: 0, model: 0 });
        if (original) {
          expect(result.recovery).toMatchObject(original);
          expect(result.recovery.preservedUnknownOperations).toHaveLength(1);
        }
        if (committedReceipt) {
          expect(result.receiptId).toBe(committedReceipt);
          expect(result.recovery.committed.receiptId).toBe(committedReceipt);
          if (phase === "emergency") {
            expect(result.priorRetention.receiptBackedRetentionChanges).toBe(1);
            expect(result.installationEvidence.fromPriorHistory).toBe(true);
            expect(result.timings.map((row: { name: string }) => row.name)).toContain("production-bind");
          }
        }
        outcomes.push(result);
      }
      expect(outcomes[1].processRestart).toBe(true);
      expect(outcomes[0].processId).not.toBe(outcomes[1].processId);
      expect(outcomes[0].receiptId).toBe(outcomes[1].receiptId);
      expect(outcomes[0].epochId).toBe(outcomes[1].epochId);
      expect(outcomes[1].callsBeforeRestart).toEqual(outcomes[0].counters);
    } finally { vi.restoreAllMocks(); await emergency?.stopEmergency(); await h.close(); vi.useRealTimers(); }
    // Keep this explicitly synthetic owned root for driver protocol diagnosis; it contains no real corpus.
  }, 110_000);
});
