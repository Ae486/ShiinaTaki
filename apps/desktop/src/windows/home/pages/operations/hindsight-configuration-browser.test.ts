import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { configurationBrowserFixture } from "./hindsight-configuration-browser-fixture.ts";

const python = "G:/anaconda3/python.exe";
// The installed full Chromium exits before navigation on this host; the same-version shell passed an isolated launch probe.
const chromium = "G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe";

it.skipIf(!existsSync(python) || !existsSync(chromium))("drives actual Home controls and Core WS across observers, reconnect, expiry and refusal", async () => {
  const fixture = await configurationBrowserFixture();
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const repo = fileURLToPath(new URL("../../../../../../../", import.meta.url));
  const artifacts = join(repo, ".trellis/tasks/10-07-hindsight-configuration-observation/research/home-browser", crypto.randomUUID());
  mkdirSync(artifacts, { recursive: true });
  const entry = join(root, "owned-configuration-entry.tsx").replaceAll("\\", "/");
  const server = await createServer({ configFile: false, root, logLevel: "error", plugins: [tailwindcss(), {
    name: "owned-configuration-home", resolveId: (id) => id === "/owned-configuration-entry.tsx" ? entry : undefined,
    load: (id) => id === entry ? browserEntry(fixture.url) : undefined,
    configureServer(vite) { vite.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/control") {
        const mode = url.searchParams.get("mode"); if (mode) fixture.native.state.mode = mode;
        const time = url.searchParams.get("time"); if (time) fixture.native.state.time = Number(time);
        if (url.searchParams.has("context")) fixture.native.current.contextIdentity = crypto.randomUUID();
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ calls: fixture.native.state.calls })); return;
      }
      if (url.pathname !== "/owned-configuration") { next(); return; }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Owned configuration Home</title><body><div id="root"></div><script type="module" src="/owned-configuration-entry.tsx"></script></body></html>');
    }); },
  }], resolve: { alias: { "@": join(root, "src") } }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } } });
  try {
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("fixture port unavailable");
    const script = join(artifacts, "browser-check.py"); writeFileSync(script, PYTHON_CHECK, "utf8");
    const result = await promisify(execFile)(python, [script, `http://127.0.0.1:${address.port}`, chromium, artifacts],
      { timeout: 90_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    writeFileSync(join(artifacts, "result.txt"), result.stdout + result.stderr, "utf8");
    expect(result.stdout).toContain("CONFIGURATION_HOME_PASS");
    expect(fixture.native.state.calls.every((path) => path.endsWith("/version") || path.endsWith("/configuration-observation"))).toBe(true);
    console.info(`Home browser evidence: ${artifacts}`);
  } catch (cause) {
    writeFileSync(join(artifacts, "failure.txt"), String(cause), "utf8"); throw cause;
  } finally { await server.close(); await fixture.close(); }
}, 120_000);

function browserEntry(url: string) {
  return `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/styles.css';
import {HomeClientContext} from '/src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '/src/windows/home/page-visibility-store.ts';
import {HindsightConfigurationSection} from '/src/windows/home/pages/operations/hindsight-configuration-card.tsx';
import {createWsClient} from '/src/lib/ws-client.ts';
import {createBrowserTransport} from '/src/lib/ws-transport.ts';
import {TIMING_POLICY_DEVELOPMENT_DEFAULTS} from '@taki/shared';
usePageVisibilityStore.getState().setActivePage('operations');
async function open(){const client=createWsClient({transport:createBrowserTransport(${JSON.stringify(url)})});
const result=await client.connect({deviceId:crypto.randomUUID(),deviceName:'owned configuration browser',role:'operator',capabilities:[]});
if(!result.ok)throw Error('fixture authentication failed');return client;}
const initial=await open();
function App(){const [client,setClient]=useState(initial);const [mounted,setMounted]=useState(true);
window.__reconnect=async()=>{client.close();setClient(null);setClient(await open());};
window.__mounted=setMounted;
return <HomeClientContext.Provider value={{client,status:client?{kind:'connected'}:{kind:'connecting'},currentTimingPolicy:()=>TIMING_POLICY_DEVELOPMENT_DEFAULTS}}><main className="mx-auto max-w-5xl p-6">{mounted&&<HindsightConfigurationSection/>}</main></HomeClientContext.Provider>;}
createRoot(document.getElementById('root')).render(<App/>);`;
}

const PYTHON_CHECK = `import json, os, sys
from playwright.sync_api import sync_playwright, expect
base, chromium, artifacts = sys.argv[1:]
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium,headless=True)
    context=browser.new_context(viewport={"width":1200,"height":950})
    first=context.new_page(); second=context.new_page()
    for page in [first,second]: page.on('pageerror',lambda error:errors.append(str(error)))
    first.goto(base+'/owned-configuration')
    expect(first.get_by_text('尚未观测。可手动读取当前 API 配置。')).to_be_visible(timeout=20000)
    first.get_by_label('观测范围').select_option('character:taki')
    expect(first.get_by_text('Bank：bank-taki',exact=True)).to_be_visible()
    first.get_by_role('button',name='重新观测配置',exact=True).click()
    expect(first.get_by_text('已观测（覆盖不完整）',exact=True)).to_be_visible()
    expect(first.get_by_text('不一致',exact=True)).to_be_visible()
    expect(first.get_by_text('仅覆盖响应的 API 进程。其他 API 副本、后台 Worker、嵌入和重排配置均未知。')).to_be_visible()
    first.screenshot(path=os.path.join(artifacts,'observed.png'),full_page=True)
    count=len(context.request.get(base+'/control').json()['calls'])
    second.goto(base+'/owned-configuration')
    expect(second.get_by_text('尚未观测。可手动读取当前 API 配置。')).to_be_visible(timeout=20000)
    second.get_by_label('观测范围').select_option('character:taki')
    expect(second.get_by_text('已观测（覆盖不完整）',exact=True)).to_be_visible()
    assert len(context.request.get(base+'/control').json()['calls'])==count
    first.close()
    second.evaluate('window.__reconnect()')
    expect(second.get_by_text('已观测（覆盖不完整）',exact=True)).to_be_visible()
    assert len(context.request.get(base+'/control').json()['calls'])==count
    context.request.get(base+'/control?mode=deny')
    second.get_by_role('button',name='重新观测配置',exact=True).click()
    expect(second.get_by_text('未获配置披露授权。需由 Native 部署管理员为此 Bank 授权。')).to_be_visible()
    assert second.get_by_text('一致',exact=True).count()==0
    assert second.get_by_text('不一致',exact=True).count()==0
    context.request.get(base+'/control?mode=success')
    second.get_by_role('button',name='重新观测配置',exact=True).click()
    expect(second.get_by_text('已观测（覆盖不完整）',exact=True)).to_be_visible()
    context.request.get(base+'/control?time=60000')
    second.get_by_role('button',name='刷新 Core 状态',exact=True).click()
    expect(second.get_by_text('观测已过期。请重新观测。',exact=True)).to_be_visible()
    assert second.get_by_text('一致',exact=True).count()==0
    context.request.get(base+'/control?mode=fail')
    second.get_by_role('button',name='重新观测配置',exact=True).click()
    expect(second.get_by_text('配置观测不可用。请检查连接后重试。')).to_be_visible()
    body=second.locator('body').inner_text()
    assert 'fixture-secret' not in body and 'private-fixture-error' not in body
    second.evaluate('window.__mounted(false)'); expect(second.get_by_role('heading',name='Hindsight 模型配置观测')).to_have_count(0)
    second.evaluate('window.__mounted(true)'); expect(second.get_by_text('尚未观测。可手动读取当前 API 配置。')).to_be_visible()
    second.get_by_label('观测范围').select_option('character:taki')
    expect(second.get_by_text('配置观测不可用。请检查连接后重试。')).to_be_visible()
    assert second.evaluate('Object.keys(localStorage).length')==0
    second.screenshot(path=os.path.join(artifacts,'failed-remount.png'),full_page=True)
    assert not errors,errors
    print(json.dumps({'verdict':'CONFIGURATION_HOME_PASS','twoObservers':True,'reconnect':True,'remount':True,'expired':True,'denied':True,'failureClearsMatch':True,'pageErrors':errors}))
    context.close();browser.close()
`;
