import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ChatErrorSchema,
  ChatSendResultSchema,
  ConnectResultSchema,
  JsonRpcSuccessResponseSchema,
} from "@taki/shared";
import { expect, it } from "vitest";
import { captureLines, jsonLine } from "./fixture/line-buffer.ts";
import { CORE_DIR, dummyProviderEnv } from "./fixture/paths.ts";
import { childEnv, getFreePort, killTree, type Proc } from "./fixture/procs.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";

// Windows kill() terminates the process instead of exercising its SIGTERM handler. This test-only preload delivers
// the same handler through IPC, then releases its own channel so it cannot keep an otherwise-drained Core alive.
const STOP_CONTROL = `process.on("message", (message) => {
  if (message !== "e2e-graceful-stop") return;
  process.disconnect();
  process.emit("SIGTERM", "SIGTERM");
});\n`;

it.each(["open", "closing"] as const)("naturally exits after failed provider requests with an %s client", async (connectionState) => {
  const fixtureParent = resolve(tmpdir());
  const fixtureRoot = mkdtempSync(join(fixtureParent, "taki-core-shutdown-"));
  let requests = 0;
  const provider = createServer((request, response) => {
    request.resume();
    requests += 1;
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Isolated shutdown fixture rejection", type: "invalid_request_error" } }));
  });
  let core: Proc | undefined;
  let operator: RpcSocket | undefined;
  try {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("missing fixture provider port");
    const port = await getFreePort();
    core = startCore({ fixtureRoot, port, providerPort: address.port });
    await Promise.race([
      core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", 30_000),
      core.exited.then(() => { throw new Error("Core exited before startup"); }),
    ]);
    operator = await openRpcSocket(`ws://127.0.0.1:${port}`);
    const connected = await operator.request("connect", {
      deviceId: randomUUID(), deviceName: "Core shutdown fixture", role: "operator", capabilities: [],
    });
    expect(ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(connected).result).status).toBe("ok");

    // Repeat the actual SDK HTTP path before shutdown. In affected Windows Node/libuv builds, a forced process.exit
    // after fetch can abort during native async-handle teardown even though both turns settled correctly.
    for (let turn = 0; turn < 2; turn += 1) {
      const frame = await operator.request("chat.send", { characterId: "taki", message: "Isolated shutdown probe" });
      const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
      await operator.waitForNotification((note) => {
        if (note.method !== "chat.error") return false;
        return ChatErrorSchema.parse(note.params).messageId === ack.messageId;
      });
    }
    expect(requests).toBe(2);
    // Both an attached peer and one concurrently closing must finish registered cleanup before SQLite closes.
    if (connectionState === "closing") operator.close();
    core.child.send("e2e-graceful-stop");
    await within(core.exited, 10_000);
    expect(core.child.signalCode).toBeNull();
    const nativeAssertions = core.stderr.lines().filter((line) => /Assertion failed:|database is not open/.test(line));
    expect(core.child.exitCode, nativeAssertions.join("\n")).toBe(0);
    expect(core.stdout.count((line) => jsonLine(line)?.msg === "shutting down")).toBe(1);
    expect(core.stderr.lines().some((line) => line.includes("Assertion failed:"))).toBe(false);
  } finally {
    operator?.close();
    if (core && core.child.exitCode === null && core.child.signalCode === null) {
      killTree(core);
      await within(core.exited, 10_000);
    }
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    // Only this fixture's mkdtemp child is removable; never derive a recursive deletion target from configuration.
    expect(dirname(fixtureRoot)).toBe(fixtureParent);
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function startCore(spec: { fixtureRoot: string; port: number; providerPort: number }): Proc {
  const control = join(spec.fixtureRoot, "graceful-stop.mjs");
  writeFileSync(control, STOP_CONTROL, "utf8");
  const child = spawn(process.execPath, ["--import", pathToFileURL(control).href, "src/main.ts"], {
    cwd: CORE_DIR,
    env: childEnv({
      ...dummyProviderEnv(),
      TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${spec.providerPort}/v1`,
      TAKI_DATA_DIR: join(spec.fixtureRoot, "core"),
      TAKI_WS_HOST: "127.0.0.1",
      TAKI_WS_PORT: String(spec.port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "true",
      TAKI_LOG_LEVEL: "info",
      NODE_ENV: "production",
    }),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  if (!child.stdout || !child.stderr) throw new Error("missing Core capture streams");
  return {
    child,
    stdout: captureLines(child.stdout),
    stderr: captureLines(child.stderr),
    exited: once(child, "close").then(() => undefined),
  };
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Core did not exit within the graceful deadline")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
