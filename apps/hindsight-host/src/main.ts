/**
 * INPUT:  fixed installed entrypoint commands and private stdin control; explicit protected registration
 * OUTPUT: value-free C1 results or a release-safe enrolled Host lifetime independent of Home
 * POS:    hindsight-host — standalone installed entry; no checkout imports, TS stripping or Core boot dependency
 */
import { parseArgs } from "node:util";
import { HINDSIGHT_CUSTODY_LIMITS, HindsightTrustedInvocationSchema } from "@taki/shared/hindsight-custody";
import { HindsightHostDiagnosticSchema, HindsightHostEnrolledSchema } from "@taki/shared/hindsight-installation";
import { custodyFailure, CustodyError } from "./custody-error.ts";
import { openInstallation } from "./installation.ts";
import { readNodeCredential } from "./credential-source.ts";
import { HOST_CONTROL_BUDGET_MS, serveCustodyHost } from "./host-client.ts";
import { enrollNode } from "./enroll-node.ts";
import { prepareCustody } from "./prepare-custody.ts";
import { readControlInput } from "./stdio-request.ts";
import { serveDeploymentHost } from "./deployment-host.ts";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { registration: { type: "string" }, "credential-output": { type: "string" }, "deployment-registration": { type: "string" } },
  });
  if (positionals.length !== 1 || !values.registration) throw new CustodyError("unsupported-installation");
  const command = positionals[0];
  if (command === "deployment-host" && values["deployment-registration"]) {
    await serveDeploymentHost({ registration: values.registration, deploymentRegistration: values["deployment-registration"] });
    return;
  }
  if (command === "prepare") {
    const request = HindsightTrustedInvocationSchema.parse(await readControlInput(process.stdin, AbortSignal.timeout(HOST_CONTROL_BUDGET_MS)));
    const installation = openInstallation(values.registration, request.owner);
    const remaining = Date.parse(request.control.deadlineAt) - Date.now();
    if (remaining <= 0) throw new CustodyError("snapshot-stale");
    writeResult(await prepareCustody(request, installation, AbortSignal.timeout(remaining)));
    return;
  }
  const installation = openInstallation(values.registration);
  if (command === "inspect-installation") {
    writeResult(HindsightHostDiagnosticSchema.parse({ version: 1, state: "diagnostic", installationId: installation.registration.installationId, deploymentReady: false }));
  } else if (command === "enroll" && values["credential-output"]) {
    const signal = AbortSignal.timeout(HOST_CONTROL_BUDGET_MS);
    await enrollNode(await readControlInput(process.stdin, signal), { installation, output: values["credential-output"] }, signal);
    writeResult(HindsightHostEnrolledSchema.parse({ version: 1, state: "enrolled", deploymentReady: false }));
  } else if (command === "serve") await serve(installation);
  else throw new CustodyError("unsupported-installation");
}

async function serve(installation: ReturnType<typeof openInstallation>): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await serveCustodyHost(installation, readNodeCredential(installation), controller.signal); }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
function writeResult(value: unknown): void {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > HINDSIGHT_CUSTODY_LIMITS.resultBytes) throw new CustodyError("input-oversize");
  process.stdout.write(`${text}\n`);
}

void main().catch((error: unknown) => {
  // A broken resident exchange closes its pipe. Writing C1's line protocol here
  // would corrupt the resident framing and could hide an uncertain effect.
  if (process.argv[2] !== "deployment-host") writeResult(custodyFailure(error));
  process.exitCode = 1;
});
