/**
 * INPUT:  explicitly paired Node credentials, installed Host identity and a lifecycle abort signal
 * OUTPUT: a real role=node connection, one complete C1 catalog and generation-owned capability dispatch
 * POS:    hindsight-host — release control transport; no operator auto-trust, reconnect replay or local Approval
 */
import { once } from "node:events";
import { JSONRPCClient, isJSONRPCRequest, isJSONRPCResponse } from "json-rpc-2.0";
import { WebSocket } from "ws";
import { ConnectResultSchema, type ConnectParams } from "@taki/shared/connect";
import { HOST_CATALOG_SCHEMA_VERSION, HOST_CONTROL_PROTOCOL_VERSION, HostFrameAckSchema } from "@taki/shared/host-control";
import { HINDSIGHT_CUSTODY_LIMITS } from "@taki/shared/hindsight-custody";
import type { HindsightNodeCredential } from "@taki/shared/hindsight-installation";
import { CUSTODY_DESCRIPTOR } from "./host-gate.ts";
import { createCustodyHostSession } from "./host-session.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { prepareCustody } from "./prepare-custody.ts";
import { CustodyError } from "./custody-error.ts";

export const HOST_CONTROL_BUDGET_MS = 90_000;

export async function connectHostTransport(url: string, signal: AbortSignal) {
  const socket = new WebSocket(url, { maxPayload: HINDSIGHT_CUSTODY_LIMITS.requestBytes, handshakeTimeout: HOST_CONTROL_BUDGET_MS });
  const client = new JSONRPCClient((frame) => {
    if (socket.readyState !== WebSocket.OPEN) throw new CustodyError("host-unavailable");
    socket.send(JSON.stringify(frame));
  });
  let notification: ((method: string, params: unknown) => void) | undefined;
  socket.on("message", (bytes) => {
    try {
      const frame: unknown = JSON.parse(bytes.toString());
      if (isJSONRPCResponse(frame)) client.receive(frame);
      else if (isJSONRPCRequest(frame) && frame.id === undefined) notification?.(frame.method, frame.params);
    } catch { socket.terminate(); }
  });
  const closed = new Promise<void>((resolve) => socket.once("close", () => {
    client.rejectAllPendingRequests("Host connection closed"); resolve();
  }));
  const abort = () => socket.terminate();
  signal.addEventListener("abort", abort, { once: true });
  socket.on("error", () => socket.terminate());
  void closed.then(() => signal.removeEventListener("abort", abort));
  if (signal.aborted) abort();
  await once(socket, "open", { signal });
  return {
    call: async (method: string, params: unknown): Promise<unknown> => client.timeout(HOST_CONTROL_BUDGET_MS).request(method, params),
    notifications: (handler: typeof notification) => { notification = handler; },
    close: () => socket.terminate(), closed,
  };
}

export function nodeConnectParams(deviceId: string): ConnectParams {
  return {
    deviceId, deviceName: "Taki Hindsight Host", role: "node", capabilities: [CUSTODY_DESCRIPTOR.capabilityId],
    host: { protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION }, catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION] },
  };
}

export async function serveCustodyHost(installation: VerifiedInstallation, credential: HindsightNodeCredential,
  signal: AbortSignal): Promise<void> {
  installation.validate();
  if (credential.deviceId !== installation.registration.executionHostId) throw new CustodyError("unsafe-installation");
  const transport = await connectHostTransport(credential.coreUrl, signal);
  let session: ReturnType<typeof createCustodyHostSession> | undefined;
  try {
    const result = ConnectResultSchema.parse(await transport.call("connect", { ...nodeConnectParams(credential.deviceId), token: credential.token }));
    if (!result.host || result.host.hostId !== credential.deviceId || result.host.protocolVersion !== HOST_CONTROL_PROTOCOL_VERSION
      || result.host.catalogSchemaVersion !== HOST_CATALOG_SCHEMA_VERSION) throw new CustodyError("host-unavailable");
    installation.validate();
    const host = result.host;
    session = createCustodyHostSession({
      identity: { hostId: host.hostId, connectionGeneration: host.connectionGeneration, catalogGeneration: 1 }, owner: installation.owner,
      prepare: (invocation, pendingSignal) => prepareCustody(invocation, installation, AbortSignal.any([signal, pendingSignal])),
      send: async (method, params) => {
        const ack = HostFrameAckSchema.parse(await transport.call(method, params));
        // Core may settle an unattended ask or timeout before our cancellation response arrives. Its terminal
        // acknowledgement refuses that result without retiring an otherwise current, authenticated connection.
        if (!ack.accepted && !(method === "capability.respond" && ["late", "duplicate", "unknown_request"].includes(ack.reason))) {
          throw new CustodyError("snapshot-stale");
        }
      },
      audit: (entry) => process.stdout.write(`${JSON.stringify({ version: 1, event: "custody-permission", ...entry })}\n`),
      onTransportFailure: () => transport.close(),
    });
    transport.notifications(session.receive);
    const catalog = await transport.call("host.catalogPublish", {
      ...host, label: "Taki Hindsight Host", catalogGeneration: 1, publishedAt: new Date().toISOString(), readiness: "ready",
      capabilities: [CUSTODY_DESCRIPTOR], workspaces: [], skills: [], mcpServers: [],
    });
    if (!HostFrameAckSchema.parse(catalog).accepted) throw new CustodyError("host-unavailable");
    await transport.closed;
  } finally {
    session?.close(); transport.close();
  }
  if (!signal.aborted) throw new CustodyError("host-unavailable");
}
