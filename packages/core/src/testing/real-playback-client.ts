/**
 * INPUT: explicit loopback Core/CDP endpoints for an owner-authorized real-browser acceptance test
 * OUTPUT: bounded RPC, real player controls and current Shared-validated playback observations
 * POS: core/testing — test-only transport; never imported by production or given account/attachment credentials
 */
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { z } from "zod";
import { BrowserPlaybackReadResultSchema, type BrowserPlaybackView } from "@taki/shared";

interface Pending {
  resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>;
}
const Targets = z.array(z.object({ url: z.string(), type: z.string(), webSocketDebuggerUrl: z.string().optional() }));
const Response = z.object({ id: z.union([z.number(), z.string()]).optional(), result: z.unknown().optional(), error: z.unknown().optional() });
const Evaluation = z.object({ exceptionDetails: z.unknown().optional(), result: z.object({ value: z.unknown().optional() }) });

async function connection(url: string, protocol: "cdp" | "rpc") {
  const socket = new WebSocket(url);
  const pending = new Map<string, Pending>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error("TEST_SOCKET_OPEN_DEADLINE")); }, 10_000);
    socket.once("open", () => { clearTimeout(timer); resolve(); });
    socket.once("error", () => { clearTimeout(timer); reject(new Error("TEST_SOCKET_OPEN_FAILED")); });
  });
  socket.on("error", () => { /* Pending calls settle through the close/deadline owner without logging frames. */ });
  socket.on("close", () => {
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("TEST_SOCKET_CLOSED")); }
    pending.clear();
  });
  socket.on("message", (data) => {
    let parsed: z.infer<typeof Response>;
    try { parsed = Response.parse(JSON.parse(data.toString())); } catch { return; }
    if (parsed.id === undefined) return;
    const key = String(parsed.id); const call = pending.get(key);
    if (!call) return;
    pending.delete(key); clearTimeout(call.timer);
    if (parsed.error !== undefined) call.reject(new Error("TEST_RPC_REFUSED"));
    else call.resolve(parsed.result);
  });
  let sequence = 0;
  return {
    call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const id = protocol === "cdp" ? ++sequence : randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(String(id)); reject(new Error("TEST_RPC_DEADLINE")); }, 15_000);
        pending.set(String(id), { resolve, reject, timer });
        socket.send(JSON.stringify({ ...(protocol === "rpc" ? { jsonrpc: "2.0" } : {}), id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

export async function createRealPlaybackClient(input: { coreUrl: string; cdpPort: number; bvid: string }) {
  const coreUrl = new URL(input.coreUrl);
  if (coreUrl.protocol !== "ws:" || coreUrl.hostname !== "127.0.0.1" || !Number.isInteger(input.cdpPort)
    || input.cdpPort < 1024 || input.cdpPort > 65535) throw new Error("TEST_REQUIRES_LOOPBACK_ENDPOINTS");
  const targets = Targets.parse(await (await fetch(`http://127.0.0.1:${input.cdpPort}/json/list`, { signal: AbortSignal.timeout(10_000) })).json());
  const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(`https://www.bilibili.com/video/${input.bvid}`));
  if (!target?.webSocketDebuggerUrl) throw new Error("TEST_SELECTED_VIDEO_NOT_OPEN");
  const targetUrl = new URL(target.webSocketDebuggerUrl);
  if (targetUrl.protocol !== "ws:" || targetUrl.hostname !== "127.0.0.1") throw new Error("TEST_CDP_TARGET_NOT_LOCAL");
  const core = await connection(input.coreUrl, "rpc");
  let browser: Awaited<ReturnType<typeof connection>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    browser = await connection(target.webSocketDebuggerUrl, "cdp");
    const activeBrowser = browser;
    await core.call("connect", { deviceId: randomUUID(), deviceName: "Real prepared playback acceptance", role: "operator", capabilities: [] });
    let current: BrowserPlaybackView | undefined; let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const snapshot = BrowserPlaybackReadResultSchema.parse(await core.call("browser.playback.read"));
        current = snapshot.enabled && snapshot.sources.length === 1 ? snapshot.sources[0] : undefined;
      } catch { current = undefined; }
      finally { refreshing = false; }
    };
    await refresh(); timer = setInterval(() => { void refresh(); }, 500); timer.unref();
    const evaluate = async (expression: string) => {
      const result = Evaluation.parse(await activeBrowser.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }));
      if (result.exceptionDetails) throw new Error("TEST_PLAYER_OPERATION_FAILED");
      return result.result.value;
    };
    return {
      view() { return current && Date.now() < Date.parse(current.freshUntil) ? structuredClone(current) : undefined; },
      async control(action: "pause" | "play" | "seek", position?: number) {
        await activeBrowser.call("Page.bringToFront");
        if (action === "seek") {
          if (position === undefined || !Number.isFinite(position) || position < 0) throw new Error("TEST_INVALID_POSITION");
          await evaluate(`window.player.mediaElement().currentTime=${position}; true`);
        } else if (action === "pause") await evaluate("window.player.mediaElement().pause(); true");
        else await evaluate("window.player.mediaElement().play().then(()=>true)");
      },
      async waitFor(predicate: (view: BrowserPlaybackView) => boolean) {
        const deadline = Date.now() + 12_000;
        while (Date.now() < deadline) {
          await refresh();
          if (current && Date.now() < Date.parse(current.freshUntil) && predicate(current)) return structuredClone(current);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("TEST_PLAYBACK_STATE_DEADLINE");
      },
      close() { clearInterval(timer); activeBrowser.close(); core.close(); },
    };
  } catch (error) { clearInterval(timer); browser?.close(); core.close(); throw error; }
}
