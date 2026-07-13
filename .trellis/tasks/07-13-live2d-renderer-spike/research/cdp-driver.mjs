// Spike runtime-evidence collector. Drives headless Edge (WebView2 = Edge Chromium
// is the production target) over the Chrome DevTools Protocol using Node's built-in
// WebSocket. Navigates to the spike harness, captures console + window.__spikeStatus,
// and saves a full-page screenshot. Scratch tool for the 07-13 renderer spike only.

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const URL = "http://localhost:1420/spike.html";
const PORT = 9333;
const OUT_DIR = "H:/TakiAgent/.trellis/tasks/07-13-live2d-renderer-spike/research";
const SHOT = join(OUT_DIR, "spike-screenshot.png");

const userDataDir = mkdtempSync(join(tmpdir(), "spike-edge-"));
const args = [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--window-size=1280,900",
  "about:blank",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

async function main() {
  const proc = spawn(EDGE, args, { stdio: "ignore" });
  proc.on("error", (e) => { console.error("SPAWN_ERROR", e); process.exit(2); });

  // Wait for the debugging endpoint + a page target.
  let pageWs = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const list = await getJson("/json/list");
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) { pageWs = page.webSocketDebuggerUrl; break; }
    } catch { /* endpoint not up yet */ }
  }
  if (!pageWs) { console.error("NO_PAGE_TARGET"); proc.kill(); process.exit(3); }

  const ws = new WebSocket(pageWs);
  const pending = new Map();
  let id = 0;
  const console_msgs = [];

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    // Events
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description ?? a.type))
        .join(" ");
      console_msgs.push(`[${msg.params.type}] ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      const desc = d.exception?.description || d.text;
      console_msgs.push(`[exception] ${desc}`);
    } else if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      console_msgs.push(`[log:${e.level}] ${e.source}: ${e.text}`);
    }
  };

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: URL });

  // Poll __spikeStatus until finishedAt is set (or timeout ~90s).
  let statusJson = null;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    try {
      const r = await send("Runtime.evaluate", {
        expression: "JSON.stringify(window.__spikeStatus || null)",
        returnByValue: true,
      });
      const val = r.result?.value;
      if (val && val !== "null") {
        statusJson = val;
        const parsed = JSON.parse(val);
        if (parsed.finishedAt || parsed.fatalError) break;
      }
    } catch (e) {
      console_msgs.push(`[driver] evaluate error: ${e.message}`);
    }
  }

  // Pretty status
  let pretty = statusJson;
  try {
    const r = await send("Runtime.evaluate", {
      expression: "JSON.stringify(window.__spikeStatus || null, null, 2)",
      returnByValue: true,
    });
    if (r.result?.value) pretty = r.result.value;
  } catch { /* keep compact */ }

  // Idle repaint note: count rAF ticks over ~1s.
  let idleNote = "n/a";
  try {
    const r = await send("Runtime.evaluate", {
      expression: `new Promise((res)=>{let n=0;const t0=performance.now();function f(){n++;if(performance.now()-t0<1000){requestAnimationFrame(f)}else{res('frames_in_1s='+n)}}requestAnimationFrame(f)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    idleNote = r.result?.value ?? "n/a";
  } catch (e) { idleNote = `error: ${e.message}`; }

  // Full-page screenshot.
  try {
    const metrics = await send("Page.getLayoutMetrics");
    const cs = metrics.cssContentSize || metrics.contentSize;
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 },
    });
    writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
  } catch (e) {
    console_msgs.push(`[driver] screenshot error: ${e.message}`);
  }

  console.log("=====SPIKE_STATUS_JSON=====");
  console.log(pretty ?? "NULL — __spikeStatus never populated");
  console.log("=====CONSOLE_MESSAGES=====");
  console.log(console_msgs.length ? console_msgs.join("\n") : "(none captured)");
  console.log("=====IDLE_NOTE=====");
  console.log(idleNote);
  console.log("=====END=====");

  ws.close();
  proc.kill();
  process.exit(0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
