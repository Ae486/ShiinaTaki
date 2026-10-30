/**
 * INPUT:  preflight/run, the one authorized validation.sqlite copy and an explicit owned endpoint
 * OUTPUT: resumable real-data validation using actual B3 and B4 producers, with content-free reports
 * POS:    operator-owned D78 task CLI; never activates authority or changes production configuration
 */
import { createRealDataClient, setupRealTarget } from "./current-cutover-real-data-client.ts";
import { RealDataSession, reportSourcePreflight } from "./current-cutover-real-data-local.ts";
import { importAllBanks, prepareAllBanks, proveReadiness, verifyAllBanks } from "./current-cutover-real-data-remote.ts";
import { finalizeConsumerCompletion, requireConsumerIdentity, requireUncompletedConsumer } from "./current-cutover-real-data-completion.ts";
import { RealDataMetadata, failureCode, listenForOperatorAbort, requireCondition, requireOwnedEndpoint } from "./current-cutover-real-data-state.ts";

async function main(): Promise<void> {
  const [mode, path, endpoint, extra] = process.argv.slice(2);
  if (mode === "--help") {
    process.stdout.write("Usage: node current-cutover-real-data.ts preflight <validation.sqlite>\n"
      + "       node current-cutover-real-data.ts run <validation.sqlite> <owned-endpoint>\n"
      + "Run requires TAKI_D78_REAL_DATA=1, TAKI_D78_OWNED_ENDPOINT, TAKI_D78_CONSUMER_ID and transient TAKI_D78_API_KEY.\n"
      + "TAKI_D78_RUN_ID selects 06acadec47e7 (default), cd01c5453b1e or 654131f0175a; each has separate copy/state.\n"
      + "Optional TAKI_D78_REQUEST_TIMEOUT_MS bounds each D78 HTTP call (default 10800000, not a completion guarantee).\n"
      + "Run mode accepts the exact stdin line abort followed by LF for graceful cancellation.\n");
    return;
  }
  let metadata: RealDataMetadata | null = null;
  let session: RealDataSession | null = null;
  let completed = false;
  let consumerId: string | null = null;
  let stopInput: (() => void) | null = null;
  const cancel = () => session?.controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    requireCondition((mode === "preflight" || mode === "run") && path && !extra, "REAL_DATA_ARGUMENTS_INVALID");
    if (mode === "run") {
      consumerId = requireConsumerIdentity(process.env.TAKI_D78_CONSUMER_ID);
      requireOwnedEndpoint(endpoint ?? "");
    }
    else requireCondition(endpoint === undefined, "REAL_DATA_ARGUMENTS_INVALID");
    metadata = new RealDataMetadata(path);
    if (consumerId) requireUncompletedConsumer({ directory: metadata.directory, consumerId });
    session = new RealDataSession(metadata);
    reportSourcePreflight(session);
    if (mode === "run") {
      stopInput = listenForOperatorAbort(process.stdin, cancel);
      await executeRemote(session, endpoint ?? "");
    }
    completed = true;
  } catch (error) {
    const stage = session?.stage ?? "ADMISSION";
    const result = { reason: failureCode(error), stage, remoteOutcome: ["ADMISSION", "PREFLIGHT"].includes(stage) ? "not-started" : "unknown" };
    if (metadata) metadata.report("REAL_DATA_VALIDATION_REFUSED", result);
    else process.stdout.write(`${JSON.stringify({ code: "REAL_DATA_VALIDATION_REFUSED", ...result })}\n`);
    process.exitCode = 1;
  } finally {
    stopInput?.();
    closeSession({ session, metadata, completed, consumerId, mode });
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

async function executeRemote(session: RealDataSession, endpoint: string): Promise<void> {
  const client = createRealDataClient(session, endpoint);
  const setup = await setupRealTarget(session, { endpoint, client: client.base });
  const prepared = await prepareAllBanks(session, client.current);
  await importAllBanks(session, { client: client.current, prepared });
  await verifyAllBanks(session, { client: client.current, prepared });
  proveReadiness(session, setup);
}

function closeSession(input: { session: RealDataSession | null; metadata: RealDataMetadata | null;
  completed: boolean; consumerId: string | null; mode: string | undefined }): void {
  const { session, metadata, consumerId } = input;
  try {
    finalizeConsumerCompletion({ succeeded: input.completed, exitCode: process.exitCode,
      target: consumerId && metadata ? { directory: metadata.directory, consumerId } : null,
      audit: () => session?.close(), cleanup: () => metadata?.close(), announce: () => {
        if (metadata?.state) metadata.report(input.mode === "preflight" ? "REAL_DATA_PREFLIGHT_COMPLETE" : "REAL_DATA_VALIDATION_COMPLETE",
          { sourceEpochId: metadata.state.sourceEpochId, runId: metadata.state.b2RunId, authorityActivated: false });
      } });
  }
  catch (error) {
    metadata?.report("REAL_DATA_FINAL_AUDIT_REFUSED", { reason: failureCode(error) });
    process.exitCode = 1;
  }
}

try { await main(); }
catch (error) {
  process.stdout.write(`${JSON.stringify({ code: "REAL_DATA_RUNNER_FAILED", reason: failureCode(error) })}\n`);
  process.exitCode = 1;
}
