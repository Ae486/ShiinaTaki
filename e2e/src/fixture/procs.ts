/**
 * INPUT:  spawn specs (command, args, cwd, env) for the core and node child processes
 * OUTPUT: spawnProc() -> Proc { child, stdout, stderr, exited }; killTree() (Windows-safe); getFreePort()
 * POS:    e2e/fixture — child-process lifecycle primitive; teardown must never leave orphans between runs
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { captureLines, type LineBuffer } from "./line-buffer.ts";

export interface Proc {
  child: ChildProcess;
  stdout: LineBuffer;
  stderr: LineBuffer;
  exited: Promise<void>;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

export function spawnProc(spec: SpawnSpec): Proc {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // POSIX only: make the child its own process-group leader so killTree can signal the whole group (grandchildren
    // included). Windows stays in our group and uses taskkill /T for the tree — detaching there spawns a new console.
    detached: process.platform !== "win32",
  });
  if (!child.stdout || !child.stderr) throw new Error("child spawned without piped stdio");
  return {
    child,
    stdout: captureLines(child.stdout),
    stderr: captureLines(child.stderr),
    exited: new Promise((resolve) => child.once("close", () => resolve())),
  };
}

/** Kills the whole process tree — the core/node may have spawned grandchildren (MCP servers, exec). */
export function killTree(proc: Proc): void {
  const { pid } = proc.child;
  if (pid === undefined || proc.child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true });
  } else {
    // A negative pid targets the whole process group (the child is a group leader — see spawnProc), so exec/MCP
    // grandchildren die with it, not just the direct child. Fall back to a plain kill if the group is already gone.
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      proc.child.kill("SIGKILL");
    }
  }
}

/** Binds port 0, reads the assigned port, releases it — a free ephemeral port for this stack's WS server. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** A hermetic child env: the parent's PATH etc. minus every inherited TAKI_* key, plus the overrides. */
export function childEnv(overrides: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("TAKI_")) delete env[key];
  }
  return { ...env, ...overrides };
}
