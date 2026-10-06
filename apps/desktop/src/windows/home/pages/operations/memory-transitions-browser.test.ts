import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createTransitionOperatorFixture } from "../../../../../../../packages/core/src/testing/memory-transition-operator-fixtures.ts";
import { W3_AT } from "../../../../../../../packages/core/src/testing/memory-transition-candidate-fixtures.ts";

const python = "G:/anaconda3/python.exe";
const chromium = "G:/AppDataMove/ms-playwright/chromium-1181/chrome-win/chrome.exe";
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.skipIf(!existsSync(python) || !existsSync(chromium))("owns real browser confirmation, focus, close, second observer and complete healthy/emergency producers", async () => {
  const fixture = await createTransitionOperatorFixture();
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const repo = fileURLToPath(new URL("../../../../../../../", import.meta.url));
  const artifacts = join(repo, ".trellis/.runtime/w7-browser-artifacts", crypto.randomUUID()); mkdirSync(artifacts, { recursive: true });
  const entryPath = join(root, "w7-owned-entry.tsx").replaceAll("\\", "/");
  const server = await createServer({ configFile: false, root, logLevel: "error", plugins: [tailwindcss(), {
    name: "owned-w7-browser", resolveId: (id) => id === "/w7-owned-entry.tsx" ? entryPath : undefined,
    load: (id) => id === entryPath ? browserEntry(fixture.url) : undefined,
    configureServer(vite) { vite.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/w7-control") {
        const delay = url.searchParams.get("delay"); if (delay !== null) fixture.control.submitDelayMs = Number(delay);
        const bindDelay = url.searchParams.get("bindDelay"); if (bindDelay !== null) fixture.control.bindDelayMs = Number(bindDelay);
        const hold = url.searchParams.get("holdBinding");
        if (hold === "1") fixture.control.holdBinding = true;
        if (hold === "0") fixture.releaseBinding();
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ...fixture.control, native: fixture.h.remote.calls })); return;
      }
      if (url.pathname !== "/w7-owned") { next(); return; }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Owned W7 browser</title><body><div id="root"></div><script type="module" src="/w7-owned-entry.tsx"></script></body></html>');
    }); },
  }], resolve: { alias: { "@": join(root, "src") } },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } } });
  try {
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("owned Vite port unavailable");
    const script = join(artifacts, "browser-check.py"); writeFileSync(script, PYTHON_CHECK, "utf8");
    const result = await promisify(execFile)(python, [script, `http://127.0.0.1:${address.port}`, chromium, artifacts, W3_AT],
      { timeout: 90000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    writeFileSync(join(artifacts, "result.txt"), result.stdout + result.stderr, "utf8");
    expect(result.stdout).toContain("W7_BROWSER_PASS");
    expect(fixture.control.submits).toBe(3);
    expect(fixture.service.overview().provider).toBe("local");
    console.info(`W7 browser evidence: ${artifacts}`);
  } finally { await server.close(); await fixture.close(); }
}, 120000);

function browserEntry(url: string) {
  return `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '/src/styles.css';
import { HomeClientContext } from '/src/windows/home/home-client-context.ts';
import { MemoryTransitionsCard } from '/src/windows/home/pages/operations/memory-transitions-card.tsx';
import { useMemoryTransitions } from '/src/windows/home/pages/operations/use-memory-transitions.ts';
import { createWsClient } from '/src/lib/ws-client.ts';
import { createBrowserTransport } from '/src/lib/ws-transport.ts';
import { createTimingPolicyStore } from '/src/lib/timing-policy.ts';
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS } from '@taki/shared';
const policy = createTimingPolicyStore({...TIMING_POLICY_DEVELOPMENT_DEFAULTS, longRpcMs:1000, interactiveRpcMs:5000});
async function open(){const client=createWsClient({transport:createBrowserTransport(${JSON.stringify(url)}),timingPolicy:policy,onTimingPolicyDiagnostic:()=>{}});
const result=await client.connect({deviceId:crypto.randomUUID(),deviceName:'owned W7 browser',role:'operator',capabilities:[]});
if(!result.ok) throw Error('owned authentication failed');return client;}
const initial=await open();
function Card(){const view=useMemoryTransitions();window.__w7view=view;return <MemoryTransitionsCard view={view}/>;}
function App(){const [client,setClient]=useState(initial);window.__w7reconnect=async()=>{client.close();setClient(null);setClient(await open());};
return <HomeClientContext.Provider value={{client,status:client?{kind:'connected'}:{kind:'connecting'},currentTimingPolicy:()=>policy.current()}}><main className="mx-auto max-w-4xl p-6"><Card/></main></HomeClientContext.Provider>;}
createRoot(document.getElementById('root')).render(<App/>);`;
}

const PYTHON_CHECK = `import json, os, sys, time
from playwright.sync_api import sync_playwright, expect
base, chromium, artifacts, fixed = sys.argv[1:]
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium,headless=True)
    context=browser.new_context(viewport={"width":1100,"height":950})
    # Only wall-clock identity is pinned to the synthetic Core clock; timers and performance.now remain real.
    context.add_init_script("const D=Date;const fixed=D.parse("+json.dumps(fixed)+");window.Date=class extends D{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};")
    first=context.new_page(); second=context.new_page()
    for page in [first,second]:
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(base+'/w7-owned')
        expect(page.get_by_role('button',name='预览返回 Local',exact=True)).to_be_enabled(timeout=20000)
    opener=first.get_by_role('button',name='预览返回 Local',exact=True)
    opener.focus(); first.keyboard.press('Enter')
    expect(first.get_by_role('button',name='取消预览')).to_be_focused()
    expect(first.get_by_role('button',name='确认切换')).to_be_enabled()
    first.keyboard.press('Escape'); expect(opener).to_be_focused()
    first.get_by_role('button',name='预览紧急接管至 Local',exact=True).click()
    expect(first.get_by_role('button',name='确认紧急接管')).to_be_enabled()
    expect(first.get_by_text('紧急接管只使用本机保全证据。远端最新状态及可能丢失的区间未知；游标相等也不能证明没有丢失。')).to_be_visible()
    first.get_by_role('button',name='取消预览').click()
    assert context.request.get(base+'/w7-control').json()['submits']==0
    context.request.get(base+'/w7-control?delay=1800&holdBinding=1')
    opener.click(); expect(first.get_by_role('button',name='确认切换')).to_be_enabled()
    started=time.monotonic()
    first.get_by_role('button',name='确认切换').evaluate('(button)=>{button.click();button.click();}')
    expect(first.get_by_text('提交超时，结果未知。Core 可能仍在执行；请刷新原操作状态，系统不会自动重提。')).to_be_visible(timeout=10000)
    elapsed=time.monotonic()-started
    second.wait_for_function("window.__w7view?.status?.entries[0]?.operation.state==='running'",timeout=20000)
    first.close()
    context.request.get(base+'/w7-control?holdBinding=0')
    second.wait_for_function("window.__w7view?.status?.provider==='local' && window.__w7view.status.entries[0].operation.state==='completed'",timeout=20000)
    original=second.evaluate('window.__w7view.status.entries[0].operation.operationId')
    second.evaluate('window.__w7reconnect()')
    second.wait_for_function("window.__w7view?.connectionReady && !window.__w7view.loading")
    assert second.evaluate('window.__w7view.status.entries[0].operation.operationId')==original
    assert context.request.get(base+'/w7-control').json()['submits']==1
    context.request.get(base+'/w7-control?delay=0&bindDelay=0')
    second.get_by_role('button',name='预览重新进入 Hindsight',exact=True).click()
    expect(second.get_by_role('button',name='确认切换')).to_be_enabled()
    second.get_by_role('button',name='确认切换').click()
    second.wait_for_function("window.__w7view?.status?.provider==='hindsight' && window.__w7view.status.entries[0].operation.state==='completed'",timeout=20000)
    native=context.request.get(base+'/w7-control').json()['native']
    second.get_by_role('button',name='预览紧急接管至 Local',exact=True).click()
    expect(second.get_by_role('button',name='确认紧急接管')).to_be_enabled()
    second.get_by_role('button',name='确认紧急接管').click()
    second.wait_for_function("window.__w7view?.status?.provider==='local' && window.__w7view.status.entries[0].operation.state==='completed'",timeout=20000)
    final=context.request.get(base+'/w7-control').json()
    assert final['submits']==3 and final['native']==native
    body=second.locator('body').inner_text()
    assert '当前已使用 Local，无需再次返回或紧急接管。' in body
    assert '请使用下方启用流程' not in body and '请使用首次启用流程' not in body
    assert '原生阶段 retired' not in body and '原生阶段 active' not in body
    assert '原生阶段 旧权威已退役' in body and '原生阶段 目标权威已激活' in body
    second.screenshot(path=os.path.join(artifacts,'final.png'),full_page=True)
    result={'verdict':'W7_BROWSER_PASS','submitCount':3,'originalOperationId':original,'lostAckClientSeconds':elapsed,'initiatorClosedWhileRunning':True,'nativeUnchangedDuringEmergency':True,'pageErrors':errors}
    assert not errors,errors
    print(json.dumps(result,ensure_ascii=False))
    context.close();browser.close()
`;
