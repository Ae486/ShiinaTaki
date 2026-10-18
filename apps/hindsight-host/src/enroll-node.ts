/**
 * INPUT:  explicit installer stdin enrollment request and a protected new Node credential destination
 * OUTPUT: role=node token issued through the existing pairing method and written create-only with mode 0600
 * POS:    hindsight-host — installer-only enrollment; never edits Core's device DB or prints its token
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ConnectResultSchema } from "@taki/shared/connect";
import { HindsightNodeCredentialSchema, HindsightNodeEnrollmentSchema } from "@taki/shared/hindsight-installation";
import { connectHostTransport, nodeConnectParams } from "./host-client.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { requireProtectedDirectory } from "./installed-files.ts";
import { CustodyError } from "./custody-error.ts";

export async function enrollNode(input: unknown, options: { installation: VerifiedInstallation; output: string }, signal: AbortSignal): Promise<void> {
  const request = HindsightNodeEnrollmentSchema.parse(input);
  const { installation } = options;
  if (installation.owner.kind !== "unix-user") throw new CustodyError("unsupported-installation");
  const output = resolve(options.output);
  requireProtectedDirectory(dirname(output), installation.owner.uid);
  const transport = await connectHostTransport(request.coreUrl, signal);
  try {
    const result = ConnectResultSchema.parse(await transport.call("connect", {
      ...nodeConnectParams(installation.registration.executionHostId), pairingCode: request.pairingCode,
    }));
    if (!result.token || !result.host || result.host.hostId !== installation.registration.executionHostId) throw new CustodyError("host-unavailable");
    installation.validate();
    writeFileSync(output, JSON.stringify(HindsightNodeCredentialSchema.parse({
      version: 1, deviceId: result.host.hostId, coreUrl: request.coreUrl, token: result.token,
    })), { flag: "wx", mode: 0o600 });
  } finally { transport.close(); }
}
