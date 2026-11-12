/**
 * INPUT: owned Core port and generated fixture credentials, never operator credentials
 * OUTPUT: real Settings/Operations pages over the production WS client, plus Playwright evidence
 * POS: first-use verification only; reuses the existing browser-test Vite/Chromium approach
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
const root = join(repo, "apps/desktop");
const require = createRequire(join(root, "package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href);
const python = "G:/anaconda3/python.exe";
const chromium = "G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe";
const browserPackages = "G:/Roaming/Python/Python312/site-packages";

function browserEnvironment() {
  // Reuse installed browser dependencies without restoring the real OS profile or enabling its user-site hooks.
  return { ...process.env, PYTHONPATH: browserPackages, PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" };
}

export function preflightHomeBrowser() {
  const script = `import json, os, site, sys
from importlib.metadata import version
import playwright
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=${JSON.stringify(chromium)}, headless=True)
    try:
        page = browser.new_page()
        page.set_content("<title>Home browser preflight</title>")
        expect(page).to_have_title("Home browser preflight")
        print(json.dumps({"status": "passed", "python": sys.executable, "pythonVersion": sys.version,
            "playwrightVersion": version("playwright"), "playwrightModule": playwright.__file__,
            "chromium": ${JSON.stringify(chromium)}, "chromiumVersion": browser.version,
            "profile": os.environ.get("USERPROFILE"), "temp": os.environ.get("TEMP"),
            "userSiteEnabled": site.ENABLE_USER_SITE, "bytecodeDisabled": sys.dont_write_bytecode}))
    finally:
        browser.close()
`;
  const result = spawnSync(python, ["-B", "-s", "-c", script], { windowsHide: true, encoding: "utf8",
    env: browserEnvironment(), timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Home browser preflight failed (${result.status}): ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

export async function startHome(corePort, artifactsRoot) {
  const entry = join(root, "owned-first-use-entry.tsx").replaceAll("\\", "/");
  const server = await createServer({ configFile: false, envDir: false, root, cacheDir: join(artifactsRoot, "vite-cache"), logLevel: "error", plugins: [tailwindcss(), {
    name: "owned-first-use-home", resolveId: (id) => id === "/owned-first-use-entry.tsx" ? entry : undefined,
    load: (id) => id === entry ? browserEntry(corePort) : undefined,
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== "/first-use") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Isolated first use</title><body><div id="root"></div><script type="module" src="/owned-first-use-entry.tsx"></script></body></html>');
    }); },
  }], resolve: { alias: { "@": join(root, "src") } }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } } });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Home fixture port missing");
  return { url: `http://127.0.0.1:${address.port}/first-use`, close: () => server.close() };
}

function browserEntry(port) {
  return `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/styles.css';
import {HomeClientContext} from '/src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '/src/windows/home/page-visibility-store.ts';
import {OperationsPage} from '/src/windows/home/pages/operations/operations-page.tsx';
import {SettingsPage} from '/src/windows/home/pages/settings/settings-page.tsx';
import {createWsClient} from '/src/lib/ws-client.ts';import {createBrowserTransport} from '/src/lib/ws-transport.ts';
import {createTimingPolicyStore} from '/src/lib/timing-policy.ts';import {TIMING_POLICY_DEVELOPMENT_DEFAULTS,MEMORY_OPERATION_TERMINAL_STATES} from '@taki/shared';
const timing=createTimingPolicyStore(TIMING_POLICY_DEVELOPMENT_DEFAULTS);
const operationChanges=[];
async function open(){const c=createWsClient({transport:createBrowserTransport('ws://127.0.0.1:${port}'),timingPolicy:timing,onTimingPolicyDiagnostic:()=>{}});
const r=await c.connect({deviceId:crypto.randomUUID(),deviceName:'owned first-use Home',role:'operator',capabilities:[]});if(!r.ok)throw Error('fixture auth failed');
c.onMemoryOperationChanged(operation=>operationChanges.push(operation));await c.subscribeMemoryOperations();return c;}
const initial=await open();usePageVisibilityStore.getState().setActivePage('operations');
function App(){const [client,setClient]=useState(initial);const [page,setPage]=useState('operations');
const navigate=(page)=>{usePageVisibilityStore.getState().setActivePage(page);setPage(page);};
window.__reconnect=async()=>{client.close();setClient(null);setClient(await open());};
window.__status=()=>client.memoryAuthorityStatus();
 window.__operation=(kind,previous)=>operationChanges.findLast(row=>row.kind===kind&&!previous.includes(row.operationId)&&MEMORY_OPERATION_TERMINAL_STATES.includes(row.state));
return <HomeClientContext.Provider value={{client,status:client?{kind:'connected'}:{kind:'connecting'},currentTimingPolicy:()=>timing.current()}}>
<main className="mx-auto max-w-5xl p-6"><nav className="mb-4 flex gap-4"><button onClick={()=>navigate('settings')}>设置页</button><button onClick={()=>navigate('operations')}>运维页</button></nav>
{page==='settings'?<SettingsPage/>:<OperationsPage/>}</main></HomeClientContext.Provider>;}
createRoot(document.getElementById('root')).render(<App/>);`;
}

export async function homeStep(ctx, action, observation, beforeInteraction) {
  const artifacts = mkdtempSync(join(ctx.root, `home-${action}-`));
  const script = fileURLToPath(new URL("./home-check.py", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-B", "-s", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: browserEnvironment() });
    let output = "";
    let preparing = false;
    child.stdout.on("data", (data) => {
      output += data;
      // Arm the sync only after Chromium and the initial page are ready, outside Native's request budget.
      if (beforeInteraction && !preparing && /HOME_INTERACTION_READY\r?\n/.test(output)) {
        preparing = true;
        beforeInteraction().then((value) => child.stdin.end(JSON.stringify(value) + "\n"), (error) => {
          child.kill();
          reject(error);
        });
      }
    });
    child.stderr.on("data", (data) => { output += data; });
    child.once("error", reject);
    const timer = setTimeout(() => child.kill(), 660_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      const safe = output.replaceAll(ctx.apiKey, "<generated-key>");
      writeFileSync(join(artifacts, "result.txt"), safe, "utf8");
      if (code !== 0) reject(new Error(`Home ${action} failed (${code}): ${safe.slice(-2500)}`));
      else resolve({ status: "passed", artifacts, output: safe });
    });
    const input = JSON.stringify({ action, observation, url: ctx.home.url, chromium, artifacts, apiKey: ctx.apiKey,
      endpoint: `http://127.0.0.1:${ctx.nativePort}` }) + "\n";
    if (beforeInteraction) child.stdin.write(input); else child.stdin.end(input);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--preflight")) {
  console.log(JSON.stringify(preflightHomeBrowser()));
}
