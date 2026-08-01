/**
 * INPUT:  StackOptions + the built taki-node binary + the core sources (run in-place via node's TS stripping)
 * OUTPUT: withStack(options, fn) — boots core + headless node with automated pairing, exposes Stack helpers,
 *         and ALWAYS tears the process tree + temp dirs down; a new scenario = a new *.e2e.test.ts calling this
 * POS:    e2e/fixture — the reusable harness entry (PRD layer B); test scope only, never imported by production code
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimelineEntry } from "@taki/shared";
import { jsonLine } from "./line-buffer.ts";
import { fetchTimelineEntries, sayToAgent, pairOperator, triggerCapability, type AgentTurn } from "./operator-drivers.ts";
import { childEnv, getFreePort, killTree, spawnProc, type Proc } from "./procs.ts";
import { CORE_DIR, dummyProviderEnv, realProviderEnv, TAKI_NODE_BIN } from "./paths.ts";
import { openRpcSocket, type RpcSocket } from "./rpc-socket.ts";
import { seedMemoryEntries, type SeedMemoryEntry } from "./seed-memory.ts";
import { seedTimeline, type SeedRow } from "./seed-timeline.ts";

/** taki-node.rs hardcodes this device name; pairing lines for the node are matched by it. */
export const NODE_DEVICE_NAME = "TakiAgent Headless Node";
const OPERATOR_DEVICE_NAME = "taki-e2e-operator";

export interface StackOptions {
  /** TAKI_GATE_AUTOAPPROVE directive spec for the node's ScriptedApprover. */
  autoApprove?: string;
  /** "dummy" (default): parseable never-called provider; "real": from .env.local (throws when absent). */
  provider?: "dummy" | "real";
  /** Spawn the node at boot (default true). */
  startNode?: boolean;
  /** Register the dev capability.trigger (adds TAKI_DEV_TRIGGER=1 to the core env) — enables stack.l1(). */
  devTrigger?: boolean;
  /** Seed <nodeDataDir>/exec-policy.json before the node boots (exec allowlist/mode/cwd scenarios read it at startup). */
  execPolicy?: unknown;
  /** Seed <nodeDataDir>/gate-decisions.json before the node boots (persisted always/never memory scenarios). */
  gateDecisions?: { capability: string; decision: "always" | "never" }[];
  /** Seed the core timeline (character "taki") BEFORE the core boots — polluted-history scenarios (D1 L2). */
  seedTimeline?: SeedRow[];
  /** Seed entry files into the workspace memory tree BEFORE the core boots — startup reconcile indexes them (files
   *  are truth); the name-recall L2's "known only in memory" setup. */
  seedMemory?: SeedMemoryEntry[];
}

/** One node-side gate decision from <node dataDir>/audit.jsonl (names-only except exec's command). */
export interface AuditRecord {
  ts: string;
  requestId: string;
  capability: string;
  decision: string;
  command?: string;
}

type LogPred = (entry: Record<string, unknown>) => boolean;

export interface Stack {
  wsUrl: string;
  coreDataDir: string;
  nodeDataDir: string;
  screenshotsDir: string;
  auditPath: string;
  core: Proc;
  node(): Proc | null;
  /** Resolves the first parsed core pino line matching pred (scans captured lines first). */
  waitForCoreLog(pred: LogPred, timeoutMs?: number): Promise<Record<string, unknown>>;
  countCoreLog(pred: LogPred): number;
  /** Spawns the node (again); feedPairing wires core's next node pairing code into the node's stdin. */
  startNode(feedPairing: boolean): Promise<void>;
  /** Kills the node's process tree and awaits its exit. */
  killNode(): Promise<void>;
  /** The memoized paired operator socket (pairs on first use). */
  operator(): Promise<RpcSocket>;
  /** L1 drive (dev capability.trigger): run a capability tool's execute with no LLM; returns its structured result. */
  l1(capability: string, input?: unknown, timeoutMs?: number): Promise<unknown>;
  /** L2 drive: one real chat turn through the agent. */
  agentSay(text: string, timeoutMs?: number): Promise<AgentTurn>;
  /** The persisted timeline oldest-first (turn-fidelity assertions: tool rows prove tool records survived). */
  timeline(): Promise<TimelineEntry[]>;
  screenshots(): string[];
  audit(): AuditRecord[];
}

interface Parts {
  autoApprove: string;
  wsUrl: string;
  coreDataDir: string;
  nodeDataDir: string;
  core: Proc;
  node: Proc | null;
  operatorSocket: RpcSocket | null;
}

export async function withStack(options: StackOptions, fn: (stack: Stack) => Promise<void>): Promise<void> {
  const parts = await bootParts(options);
  try {
    await fn(makeStack(parts));
  } finally {
    await teardown(parts);
  }
}

// Base core env for an e2e stack. TAKI_TRUST_LOOPBACK_OPERATOR is forced off because these scenarios drive
// the real pairing handshake (operator-drivers expects PAIRING_REQUIRED); P3 auto-trust is covered by unit tests.
function baseCoreEnv(port: number, coreDataDir: string, provider: Record<string, string>): Record<string, string> {
  return {
    TAKI_WS_HOST: "127.0.0.1",
    TAKI_WS_PORT: String(port),
    TAKI_LOG_LEVEL: "info",
    TAKI_DATA_DIR: coreDataDir,
    TAKI_TRUST_LOOPBACK_OPERATOR: "false",
    ...provider,
  };
}

async function bootParts(options: StackOptions): Promise<Parts> {
  if (!existsSync(TAKI_NODE_BIN)) {
    throw new Error(`taki-node binary missing at ${TAKI_NODE_BIN} — build it: cargo build --bin taki-node`);
  }
  const provider = options.provider === "real" ? realProviderEnv() : dummyProviderEnv();
  if (!provider) throw new Error("real provider env missing in .env.local — gate the test with skipIf");

  const port = await getFreePort();
  const coreDataDir = mkdtempSync(join(tmpdir(), "taki-e2e-core-"));
  const nodeDataDir = mkdtempSync(join(tmpdir(), "taki-e2e-node-"));
  const coreEnv = baseCoreEnv(port, coreDataDir, provider);
  // The dev L1 drive is env double-gated: the core only registers capability.trigger when this is exactly "1".
  if (options.devTrigger) coreEnv.TAKI_DEV_TRIGGER = "1";
  // Pre-boot seeding (timeline rows and/or memory entry files) must land BEFORE the core opens the db and runs its
  // startup reconcile (sequential single-writer). The teardown guard below starts at the core spawn, so a failed
  // seed cleans its own temp dirs here.
  try {
    if (options.seedTimeline !== undefined && options.seedTimeline.length > 0) {
      seedTimeline(coreDataDir, options.seedTimeline);
    }
    if (options.seedMemory !== undefined && options.seedMemory.length > 0) {
      seedMemoryEntries(coreDataDir, options.seedMemory);
    }
  } catch (error) {
    for (const dir of [coreDataDir, nodeDataDir]) rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const parts: Parts = {
    autoApprove: options.autoApprove ?? "allow-once",
    wsUrl: `ws://127.0.0.1:${port}`,
    coreDataDir,
    nodeDataDir,
    core: spawnProc({ command: process.execPath, args: ["src/main.ts"], cwd: CORE_DIR, env: childEnv(coreEnv) }),
    node: null,
    operatorSocket: null,
  };
  // B3: once the core process (or a temp dir) exists, ANY boot failure must tear the whole stack down — a leaked
  // core/node process or temp dir would poison later runs. Everything after the spawn lives inside this guard.
  try {
    await waitCoreListening(parts);
    // Seed node-side config BEFORE the node boots (ExecPolicy::load reads it once at startup).
    if (options.execPolicy !== undefined) {
      writeFileSync(join(nodeDataDir, "exec-policy.json"), JSON.stringify(options.execPolicy));
    }
    if (options.gateDecisions !== undefined) {
      const decisions = options.gateDecisions.map((entry) => ({ ...entry, decidedAt: new Date().toISOString() }));
      writeFileSync(join(nodeDataDir, "gate-decisions.json"), JSON.stringify({ decisions }));
    }
    if (options.startNode !== false) await startNodeProc(parts, true);
    return parts;
  } catch (error) {
    await teardown(parts);
    throw error;
  }
}

async function waitCoreListening(parts: Parts): Promise<void> {
  const listening = parts.core.stdout.waitFor(matchJson((entry) => entry.msg === "ws server listening"), 30_000);
  // The loser of the race must never turn into an unhandled rejection, so exit resolves to an Error value.
  const died = parts.core.exited.then(
    () => new Error(`core exited before listening; stderr tail: ${parts.core.stderr.lines().slice(-5).join(" | ")}`),
  );
  const winner = await Promise.race([listening, died]);
  if (winner instanceof Error) throw winner;
}

async function startNodeProc(parts: Parts, feedPairing: boolean): Promise<void> {
  const node = spawnProc({
    command: TAKI_NODE_BIN,
    args: [],
    cwd: parts.nodeDataDir,
    env: childEnv({
      TAKI_DATA_DIR: parts.nodeDataDir,
      TAKI_WS_URL: parts.wsUrl,
      TAKI_GATE_AUTOAPPROVE: parts.autoApprove,
    }),
  });
  parts.node = node;
  // On reconnect (persisted token) no code is issued; the feeder simply never fires and is dropped.
  if (feedPairing) void feedNodePairingCode(parts).catch(() => undefined);
  await node.stderr.waitFor((line) => line.includes("state=connected"), 30_000);
}

async function feedNodePairingCode(parts: Parts): Promise<void> {
  const line = await parts.core.stdout.waitFor(
    matchJson((entry) => entry.msg === "pairing code issued" && entry.deviceName === NODE_DEVICE_NAME),
    20_000,
  );
  parts.node?.child.stdin?.write(`${String(jsonLine(line)?.code)}\n`);
}

async function getOperator(parts: Parts): Promise<RpcSocket> {
  if (parts.operatorSocket) return parts.operatorSocket;
  const socket = await openRpcSocket(parts.wsUrl);
  const getCode = async (): Promise<string> => {
    const line = await parts.core.stdout.waitFor(
      matchJson((entry) => entry.msg === "pairing code issued" && entry.deviceName === OPERATOR_DEVICE_NAME),
      20_000,
    );
    return String(jsonLine(line)?.code);
  };
  await pairOperator(socket, { deviceId: randomUUID(), deviceName: OPERATOR_DEVICE_NAME, getCode });
  parts.operatorSocket = socket;
  return socket;
}

function makeStack(parts: Parts): Stack {
  const screenshotsDir = join(parts.coreDataDir, "workspace", "screenshots");
  const auditPath = join(parts.nodeDataDir, "audit.jsonl");
  return {
    wsUrl: parts.wsUrl,
    coreDataDir: parts.coreDataDir,
    nodeDataDir: parts.nodeDataDir,
    screenshotsDir,
    auditPath,
    core: parts.core,
    node: () => parts.node,
    waitForCoreLog: async (pred, timeoutMs) => {
      const line = await parts.core.stdout.waitFor(matchJson(pred), timeoutMs);
      return jsonLine(line) ?? {};
    },
    countCoreLog: (pred) => parts.core.stdout.count(matchJson(pred)),
    startNode: (feedPairing) => startNodeProc(parts, feedPairing),
    killNode: async () => {
      if (!parts.node) return;
      killTree(parts.node);
      await parts.node.exited;
    },
    operator: () => getOperator(parts),
    l1: async (capability, input, timeoutMs) =>
      triggerCapability(await getOperator(parts), { capability, input, timeoutMs }),
    agentSay: async (text, timeoutMs) => sayToAgent(await getOperator(parts), text, timeoutMs),
    timeline: async () => fetchTimelineEntries(await getOperator(parts), "taki"),
    screenshots: () => (existsSync(screenshotsDir) ? readdirSync(screenshotsDir) : []),
    audit: () => readAudit(auditPath),
  };
}

function readAudit(auditPath: string): AuditRecord[] {
  if (!existsSync(auditPath)) return [];
  return readFileSync(auditPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditRecord);
}

function matchJson(pred: LogPred): (raw: string) => boolean {
  return (raw) => {
    const entry = jsonLine(raw);
    return entry !== null && pred(entry);
  };
}

async function teardown(parts: Parts): Promise<void> {
  parts.operatorSocket?.close();
  if (parts.node) killTree(parts.node);
  killTree(parts.core);
  const exits = [parts.core.exited, ...(parts.node ? [parts.node.exited] : [])];
  await Promise.allSettled(exits);
  for (const dir of [parts.coreDataDir, parts.nodeDataDir]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
