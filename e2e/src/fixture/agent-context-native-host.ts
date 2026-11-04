/**
 * INPUT: owned production Core, authenticated operator and isolated scenario evidence
 * OUTPUT: paired exec-only native Host, real hostname preflight/audit and bounded cleanup evidence
 * POS: e2e/fixture — test-only lifecycle composition; production Core and Node retain all governance
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { EXTENSION_METHODS, ExtensionConvergenceResultSchema, JsonRpcSuccessResponseSchema, type ExtensionConvergenceResult } from "@taki/shared";
import { type InitiativeProcess } from "./initiative-process.ts";
import { jsonLine } from "./line-buffer.ts";
import { startNodeProcess, type NodeProcessParts } from "./node-process.ts";
import { setPermissionLevel, triggerCapability } from "./operator-drivers.ts";
import { TAKI_NODE_BIN } from "./paths.ts";
import { killTree } from "./procs.ts";
import { readJsonLines, seedNodeState } from "./stack-support.ts";
import type { RpcSocket } from "./rpc-socket.ts";

export interface NativeAgentHost {
  readonly hostname: string;
  readonly accepted: ExtensionConvergenceResult;
  readonly preflightAuditCount: number;
  audit(): Record<string, unknown>[];
  save(): void;
  close(): Promise<void>;
}

export async function startAgentContextNativeHost(input: {
  core: InitiativeProcess; socket: RpcSocket; evidenceDir: string;
}): Promise<NativeAgentHost> {
  if (!existsSync(TAKI_NODE_BIN)) throw new Error("native agent Host binary missing; rebuild current taki-node source");
  const dataDir = resolve(mkdtempSync(join(tmpdir(), "taki-agent-interface-node-")));
  const parts: NodeProcessParts = { autoApprove: "exec=deny", wsUrl: input.core.wsUrl, nodeDataDir: dataDir,
    secondNodeDataDir: null, relay: null, secondRelay: null, node: null, secondNode: null };
  const deviceName = `Agent interface native ${randomUUID()}`;
  let accepted: ExtensionConvergenceResult | undefined;
  let preflightResult: unknown;
  let audit: Record<string, unknown>[] = [];
  let removed = false;
  let startupFailed = false;
  let cleanupFailed = false;
  let closeRequested = false;
  let closing: Promise<void> | undefined;
  const readAudit = () => removed ? audit : readJsonLines<Record<string, unknown>>(join(dataDir, "audit.jsonl"));
  const save = () => writeFileSync(join(input.evidenceDir, "native-host.json"), `${JSON.stringify({
    kind: "native-exec-only-host", binary: TAKI_NODE_BIN, dataDir, deviceName, accepted: accepted ?? null,
    policy: { mode: "allowlist", allowlist: ["hostname"], cwd: dataDir }, autoApprove: parts.autoApprove, preflightResult,
    pid: parts.node?.child.pid ?? null, exitCode: parts.node?.child.exitCode ?? null,
    signalCode: parts.node?.child.signalCode ?? null, exited: parts.node !== null
      && (parts.node.child.exitCode !== null || parts.node.child.signalCode !== null),
    closed: closeRequested, startupFailed, cleanupFailed, nodeDataRemoved: removed, audit: readAudit(),
  }, null, 2)}\n`, "utf8");
  const close = (): Promise<void> => {
    closeRequested = true;
    return closing ??= (async () => {
      try {
        if (parts.node) {
          killTree(parts.node);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([parts.node.exited, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("native Host exit deadline exceeded")), 10_000);
          })]); } finally { clearTimeout(timer); }
        }
        audit = readAudit();
        const target = relative(resolve(tmpdir()), dataDir);
        if (isAbsolute(target) || target.startsWith("..") || !target.startsWith("taki-agent-interface-node-")) {
          throw new Error("native Host cleanup target is outside its owned temporary directory");
        }
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        removed = !existsSync(dataDir);
        if (!removed) throw new Error("native Host temporary directory cleanup failed");
      }
      catch (error) { cleanupFailed = true; throw error; }
      finally { save(); }
    })();
  };
  try {
    save();
    seedNodeState(dataDir, { execPolicy: { mode: "allowlist", allowlist: ["hostname"], cwd: dataDir } });
    await startNodeProcess(parts, { slot: "primary", deviceName, capabilities: ["exec"], pairingCode: async () => {
      const line = await input.core.core.stdout.waitFor((raw) => {
        const entry = jsonLine(raw);
        return entry?.msg === "pairing code issued" && entry.deviceName === deviceName;
      }, 20_000);
      const code = jsonLine(line)?.code;
      if (typeof code !== "string") throw new Error("native Host pairing code unavailable");
      return code;
    } });
    const frame = await input.socket.request(EXTENSION_METHODS.status, {});
    accepted = ExtensionConvergenceResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
    const entries = accepted.entries.filter((entry) => entry.identity.ownerHostId !== accepted!.coreHostId);
    if (entries.length !== 1 || !entries[0]?.available || entries[0].identity.subjectId !== "exec"
      || !accepted.hosts.some((host) => host.hostId === entries[0]!.identity.ownerHostId && host.available)) {
      throw new Error("native Host exec catalog was not accepted and available");
    }
    await setPermissionLevel(input.socket, "relaxed");
    const result = await triggerCapability(input.socket, { capability: "exec", input: { command: "hostname" } });
    preflightResult = result;
    if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true
      || !("exitCode" in result) || result.exitCode !== 0 || !("stdout" in result)
      || typeof result.stdout !== "string" || !result.stdout.trim()) throw new Error("native hostname preflight failed");
    audit = readAudit();
    if (!audit.some((entry) => entry.capability === "exec" && entry.command === "hostname" && entry.decision === "auto-allowed")) {
      throw new Error("native hostname preflight lacks its successful allowlist audit");
    }
    save();
    return { accepted, hostname: result.stdout.trim(), preflightAuditCount: audit.length, audit: readAudit, save, close };
  } catch (error) {
    startupFailed = true;
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "native Host startup and cleanup both failed", { cause: cleanupError }); }
    throw error;
  }
}
