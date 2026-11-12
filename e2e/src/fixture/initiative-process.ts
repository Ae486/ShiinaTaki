/**
 * INPUT: an isolated data directory, local provider endpoint, and Core settings for one initiative scenario.
 * OUTPUT: a real Core child, correlated test-only IPC commands, and bounded graceful/forced teardown.
 * POS: e2e/fixture — owns process handles only; public observations still use authenticated WS or read-only SQLite.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureLines, jsonLine } from "./line-buffer.ts";
import { CORE_DIR, dummyProviderEnv } from "./paths.ts";
import { childEnv, getFreePort, killTree, type Proc } from "./procs.ts";

export interface InitiativeProcess {
  core: Proc;
  wsUrl: string;
  command(input: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

interface PendingCommand { resolve(value: unknown): void; reject(error: Error): void }

export async function startInitiativeProcess(input: {
  dataDir: string;
  providerBaseUrl: string;
  settings?: Record<string, string>;
  productionEntry?: boolean;
}): Promise<InitiativeProcess> {
  const port = await getFreePort();
  const core = launch({ ...input, port });
  const pending = new Map<string, PendingCommand>();
  const ready = new Promise<void>((resolve) => {
    core.child.on("message", (frame: unknown) => route(frame, pending, resolve));
  });
  const exited = core.exited.then(() => {
    const error = new Error("initiative Core exited");
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    throw error;
  });
  // The lifetime rejection remains observed after the startup race has already resolved.
  void exited.catch(() => undefined);
  try {
    await deadline(Promise.race([ready, exited]), 30_000);
    await core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", 5_000);
  } catch (error) {
    killTree(core);
    await core.exited.catch(() => undefined);
    throw new Error(`initiative Core failed startup: ${core.stderr.lines().slice(-8).join(" | ")}`, { cause: error });
  }
  return {
    core, wsUrl: `ws://127.0.0.1:${port}`,
    command: (command, timeoutMs = 30_000) => request(core, pending, { command, timeoutMs }),
    close: async () => {
      if (core.child.exitCode !== null || core.child.signalCode !== null) return;
      try { core.child.send({ action: "stop" }); await deadline(core.exited, 10_000); }
      catch { killTree(core); await core.exited; }
    },
  };
}

function launch(input: { dataDir: string; providerBaseUrl: string; settings?: Record<string, string>; port: number; productionEntry?: boolean }): Proc {
  const child = spawn(process.execPath, [fileURLToPath(new URL(input.productionEntry ? "./pattern-process-entry.ts" : "./initiative-test-entry.ts", import.meta.url))], {
    cwd: CORE_DIR,
    env: childEnv({ ...dummyProviderEnv(), ...input.settings,
      TAKI_DATA_DIR: input.dataDir, TAKI_PROVIDER_BASE_URL: input.providerBaseUrl,
      TAKI_WS_HOST: "127.0.0.1", TAKI_WS_PORT: String(input.port), TAKI_TRUST_LOOPBACK_OPERATOR: "true",
      TAKI_LOG_LEVEL: "info", TAKI_HINDSIGHT_ENABLED: "false",
      TAKI_CREDENTIALS_DIRECTORY: join(input.dataDir, "no-credentials"), CREDENTIALS_DIRECTORY: "",
    }),
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true, detached: process.platform !== "win32",
  });
  if (!child.stdout || !child.stderr) throw new Error("missing initiative Core capture streams");
  return { child, stdout: captureLines(child.stdout), stderr: captureLines(child.stderr),
    exited: new Promise((resolve, reject) => { child.once("close", () => resolve()); child.once("error", reject); }),
  };
}

function route(frame: unknown, pending: Map<string, PendingCommand>, ready: () => void): void {
  if (!frame || typeof frame !== "object") return;
  const message = frame as Record<string, unknown>;
  if (message.ready === true) { ready(); return; }
  if (typeof message.id !== "string") return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (typeof message.error === "string") waiter.reject(new Error(message.error));
  else waiter.resolve(message.result);
}

async function request(core: Proc, pending: Map<string, PendingCommand>, input: {
  command: Record<string, unknown>; timeoutMs: number;
}): Promise<unknown> {
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    core.child.send({ ...input.command, id }, (error) => { if (error) reject(error); });
  });
  try { return await deadline(result, input.timeoutMs); }
  finally { pending.delete(id); }
}

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("initiative process deadline exceeded")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
