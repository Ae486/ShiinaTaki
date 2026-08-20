/**
 * INPUT:  shared withStack state, a Node slot, optional capability catalog, and optional pairing-code supplier
 * OUTPUT: startNodeProcess()/killNodeProcess() manage one debug taki-node independently
 * POS:    e2e/fixture — process lifecycle helper; it owns no Core authority and is never imported by production code
 */
import { childEnv, killTree, spawnProc, type Proc } from "./procs.ts";
import { TAKI_NODE_BIN } from "./paths.ts";
import type { CapabilityRelay } from "./ws-relay.ts";

export type NodeSlot = "primary" | "secondary";

export interface NodeProcessParts {
  autoApprove: string;
  wsUrl: string;
  nodeDataDir: string;
  secondNodeDataDir: string | null;
  relay: CapabilityRelay | null;
  secondRelay: CapabilityRelay | null;
  node: Proc | null;
  secondNode: Proc | null;
}

export async function startNodeProcess(
  parts: NodeProcessParts,
  spec: { slot: NodeSlot; deviceName: string; capabilities?: readonly string[]; pairingCode?: () => Promise<string> },
): Promise<void> {
  const { slot, deviceName, pairingCode, capabilities } = spec;
  const dataDir = slot === "primary" ? parts.nodeDataDir : parts.secondNodeDataDir;
  if (!dataDir) throw new Error("second node was not configured for this stack");
  const relay = slot === "primary" ? parts.relay : parts.secondRelay;
  const node = spawnProc({
    command: TAKI_NODE_BIN,
    args: [],
    cwd: dataDir,
    env: childEnv({
      TAKI_DATA_DIR: dataDir,
      TAKI_WS_URL: relay?.url ?? parts.wsUrl,
      TAKI_GATE_AUTOAPPROVE: parts.autoApprove,
      TAKI_DEVICE_NAME: deviceName,
      ...(capabilities ? { TAKI_CAPABILITIES: capabilities.join(",") } : {}),
    }),
  });
  if (slot === "primary") parts.node = node;
  else parts.secondNode = node;
  if (pairingCode) void pairingCode().then((code) => node.child.stdin?.write(`${code}\n`)).catch(() => undefined);
  await node.stderr.waitFor((line) => line.includes("state=connected"), 30_000);
}

export async function killNodeProcess(parts: NodeProcessParts, slot: NodeSlot): Promise<void> {
  const node = slot === "primary" ? parts.node : parts.secondNode;
  if (!node || node.child.exitCode !== null) return;
  killTree(node);
  await node.exited;
}
