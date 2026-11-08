import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { templateHomeFixture } from "./hindsight-template-test-fixture.ts";

const python = "G:/anaconda3/python.exe";
// The installed full Chromium exits before navigation on this host; the same-version shell passed an isolated launch probe.
const chromium = "G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe";
it.skipIf(!existsSync(python) || !existsSync(chromium))("completes integrated Operations preview, partial recovery, independent customization, derived observation and removal", async () => {
  const fixture = await templateHomeFixture();
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const repo = fileURLToPath(new URL("../../../../../../../", import.meta.url));
  const artifacts = join(repo, ".trellis/tasks/10-07-hindsight-template-lifecycle/research/b3-home-browser", crypto.randomUUID());
  mkdirSync(artifacts, { recursive: true });
  const entry = join(root, "owned-template-entry.tsx").replaceAll("\\", "/");
  const server = await createServer({ configFile: false, root, cacheDir: join(artifacts, "vite-cache"), logLevel: "error", plugins: [tailwindcss(), {
    name: "owned-template-home", resolveId: (id) => id === "/owned-template-entry.tsx" ? entry : undefined,
    load: (id) => id === entry ? browserEntry(fixture.url) : undefined,
    configureServer(vite) { vite.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/control") {
        const delay = url.searchParams.get("delay"); if (delay !== null) fixture.control.submitDelayMs = Number(delay);
        const failed = url.searchParams.get("failBank"); if (failed !== null) fixture.control.failBank = failed || null;
        const hold = url.searchParams.get("hold"); if (hold === "1") fixture.control.holdApply = true; if (hold === "0") fixture.release();
        const child = url.searchParams.get("child"); if (child === "completed" || child === "failed" || child === "pending") fixture.control.childState = child;
        const failDerived = url.searchParams.get("failDerived"); if (failDerived !== null) fixture.control.derivedFails = failDerived === "1";
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ...fixture.control,
          bankIds: fixture.f.bindings.map((bank) => bank.externalBankId), plan: fixture.f.service.status({}).plan,
          applyCalls: fixture.f.native.calls.filter((call) => call.method === "apply").length })); return;
      }
      if (url.pathname !== "/owned-templates") { next(); return; }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Owned template Operations</title><body><div id="root"></div><script type="module" src="/owned-template-entry.tsx"></script></body></html>');
    }); },
  }], resolve: { alias: { "@": join(root, "src") } }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } } });
  try {
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("owned fixture port missing");
    const script = join(artifacts, "browser-check.py"); writeFileSync(script, PYTHON_CHECK, "utf8");
    const result = await promisify(execFile)(python, [script, `http://127.0.0.1:${address.port}`, chromium, artifacts],
      { timeout: 150_000, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    writeFileSync(join(artifacts, "result.txt"), result.stdout + result.stderr, "utf8"); expect(result.stdout).toContain("TEMPLATE_HOME_PASS");
  } catch (cause) { writeFileSync(join(artifacts, "failure.txt"), String(cause), "utf8"); throw cause; }
  finally { fixture.release(); await server.close(); await fixture.close(); }
}, 180_000);

function browserEntry(url: string) {
  return `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import '/src/styles.css';
import {HomeClientContext} from '/src/windows/home/home-client-context.ts';
import {usePageVisibilityStore} from '/src/windows/home/page-visibility-store.ts';
import {OperationsPage} from '/src/windows/home/pages/operations/operations-page.tsx';
import {createWsClient} from '/src/lib/ws-client.ts';import {createBrowserTransport} from '/src/lib/ws-transport.ts';
import {createTimingPolicyStore} from '/src/lib/timing-policy.ts';import {TIMING_POLICY_DEVELOPMENT_DEFAULTS} from '@taki/shared';
usePageVisibilityStore.getState().setActivePage('operations');
const timing=createTimingPolicyStore({...TIMING_POLICY_DEVELOPMENT_DEFAULTS,interactiveRpcMs:1000});
async function open(){const client=createWsClient({transport:createBrowserTransport(${JSON.stringify(url)}),timingPolicy:timing,onTimingPolicyDiagnostic:()=>{}});
const result=await client.connect({deviceId:crypto.randomUUID(),deviceName:'owned template Home',role:'operator',capabilities:[]});if(!result.ok)throw Error('fixture auth failed');return client;}
const initial=await open();function App(){const [client,setClient]=useState(initial);const [key,setKey]=useState(0);
window.__reconnect=async()=>{client.close();setClient(null);setClient(await open());};window.__remount=()=>setKey(v=>v+1);
return <HomeClientContext.Provider value={{client,status:client?{kind:'connected'}:{kind:'connecting'},currentTimingPolicy:()=>timing.current()}}><main className="mx-auto max-w-5xl p-6"><OperationsPage key={key}/></main></HomeClientContext.Provider>;}
createRoot(document.getElementById('root')).render(<App/>);`;
}

const PYTHON_CHECK = `import json, os, sys
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect
base, chromium, artifacts = sys.argv[1:]
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=chromium,headless=True)
    context=browser.new_context(viewport={"width":1250,"height":1100})
    first=context.new_page(); second=context.new_page()
    for page in [first,second]:
        page.on('pageerror',lambda error:(errors.append(str(error)),print('PAGE_ERROR: '+str(error),file=sys.stderr,flush=True)))
        page.on('console',lambda message:print('CONSOLE_ERROR: '+message.text,file=sys.stderr,flush=True) if message.type=='error' else None)
        page.goto(base+'/owned-templates')
    def section(page): return page.locator('section').filter(has=page.get_by_role('heading',name='Hindsight 模板与用户定制',exact=True))
    a=section(first); b=section(second)
    bank_ids=context.request.get(base+'/control').json()['bankIds']
    try:
        expect(a.get_by_role('button',name='预览模板变更',exact=True)).to_be_enabled(timeout=25000)
    except Exception:
        first.screenshot(path=os.path.join(artifacts,'startup-failure.png'),full_page=True)
        with open(os.path.join(artifacts,'startup-failure.json'),'w',encoding='utf-8') as output:
            json.dump({'pageErrors':errors,'body':first.locator('body').inner_text()},output,ensure_ascii=False,indent=2)
        raise
    a.get_by_role('button',name='预览模板变更',exact=True).click()
    expect(a.get_by_role('button',name='确认应用模板变更',exact=True)).to_be_enabled()
    expect(a.get_by_role('region',name='模板变更预览').locator('article')).to_have_count(2)
    global_preview=a.get_by_role('region',name='模板变更预览').locator('article').filter(has=first.get_by_role('heading',name='全局 · '+bank_ids[0],exact=True))
    template_text=global_preview.get_by_text('记忆提取重点',exact=True).locator('..').locator('p').nth(1).inner_text()
    expect(a.get_by_role('button',name='取消预览',exact=True)).to_be_focused()
    # Escape must work while inspecting Bank consequences, not only in the confirmation footer.
    before_images=global_preview.get_by_text('核对原有配置与资源',exact=True)
    before_images.focus(); expect(before_images).to_be_focused()
    first.keyboard.press('Escape')
    expect(a.get_by_role('region',name='模板变更预览')).to_have_count(0)
    expect(a.get_by_role('button',name='预览模板变更',exact=True)).to_be_focused()
    a.get_by_role('button',name='预览模板变更',exact=True).click()
    expect(a.get_by_role('button',name='确认应用模板变更',exact=True)).to_be_enabled()
    assert context.request.get(base+'/control').json()['applyCalls']==0
    a.screenshot(path=os.path.join(artifacts,'all-bank-preview.png'))
    # Hold the second Bank so the other observer sees a real partial rollout before closing the initiator.
    second_bank=a.get_by_role('region',name='模板变更预览').locator('article').nth(1).get_by_role('heading').inner_text().split(' · ',1)[1]
    context.request.get(base+'/control?delay=1500&hold=1&failBank='+quote(second_bank))
    a.get_by_role('button',name='确认应用模板变更',exact=True).evaluate('(button)=>{button.click();button.click();}')
    expect(b.get_by_text('Native 已确认：1 / 2 个 Bank',exact=True)).to_be_visible(timeout=20000)
    expect(a.get_by_text('提交超时，结果未知。正在读取原计划；系统不会自动重提。',exact=True)).to_be_visible(timeout=10000)
    before=context.request.get(base+'/control').json(); assert before['submits']==1 and before['entered']
    original=before['plan']['originalOperationId']; first.close()
    context.request.get(base+'/control?hold=0')
    expect(b.get_by_role('button',name='恢复原模板计划',exact=True)).to_be_enabled(timeout=20000)
    b.screenshot(path=os.path.join(artifacts,'partial-original-plan.png'))
    second.evaluate('window.__reconnect()')
    expect(b.get_by_role('button',name='恢复原模板计划',exact=True)).to_be_enabled(timeout=20000)
    assert context.request.get(base+'/control').json()['submits']==1
    context.request.get(base+'/control?delay=0&failBank=')
    b.get_by_role('button',name='恢复原模板计划',exact=True).click()
    expect(b.get_by_text('Core 已确认该计划完成绑定，无需恢复。',exact=True)).to_be_visible(timeout=20000)
    assert context.request.get(base+'/control').json()['plan']['originalOperationId']==original
    b.get_by_label('模板管理范围').select_option(bank_ids[0])
    expect(b.get_by_label('记忆提取重点模式')).to_be_enabled()
    b.get_by_label('记忆提取重点模式').select_option('suppress')
    expect(b.get_by_text('该项已明确停用；切回继承才能恢复模板或原有配置。',exact=True)).to_be_visible()
    b.get_by_label('记忆提取重点模式').select_option('inherit')
    expect(b.get_by_label('记忆提取重点自定义值')).to_have_count(0)
    b.get_by_label('记忆提取重点模式').select_option('value')
    # An explicit value equal to the Taki definition must remain a user choice after removal.
    b.get_by_label('记忆提取重点自定义值').fill(template_text)
    b.get_by_role('button',name='添加记忆模型选择',exact=True).click()
    b.get_by_label('资源标识',exact=True).fill('abandoned-model')
    expect(b.get_by_role('button',name='预览模板变更',exact=True)).to_be_disabled()
    second.evaluate('window.__reconnect()')
    expect(b.get_by_label('资源标识',exact=True)).to_be_enabled(timeout=20000)
    expect(b.get_by_label('资源标识',exact=True)).to_have_value('abandoned-model')
    expect(b.get_by_role('button',name='预览模板变更',exact=True)).to_be_disabled()
    assert context.request.get(base+'/control').json()['submits']==2
    b.get_by_role('button',name='取消资源编辑',exact=True).click()
    expect(b.get_by_role('button',name='预览模板变更',exact=True)).to_be_enabled()
    b.get_by_role('button',name='添加记忆模型选择',exact=True).click()
    b.get_by_label('资源标识',exact=True).fill('home-user-model')
    b.get_by_label('资源名称',exact=True).fill('Home user model')
    b.get_by_label('资源内容',exact=True).fill('Summarize user-selected context')
    b.get_by_role('button',name='保存到预览草稿',exact=True).click()
    b.get_by_role('button',name='预览模板变更',exact=True).click()
    expect(b.get_by_role('button',name='确认应用模板变更',exact=True)).to_be_enabled()
    b.get_by_text('记忆模型：Home user model（home-user-model）',exact=True).locator('..').get_by_role('button',name='将此模型加入生成预览',exact=True).click()
    expect(b.get_by_role('button',name='确认应用模板变更',exact=True)).to_have_count(0)
    b.get_by_role('button',name='预览模板变更',exact=True).click()
    expect(b.get_by_role('button',name='确认应用模板变更',exact=True)).to_be_disabled()
    b.get_by_role('checkbox',name='我同意本次列出的生成任务可能调用模型 / 嵌入并产生费用，外部调用重试不保证只计费一次',exact=True).check()
    b.screenshot(path=os.path.join(artifacts,'customization-consequences.png'))
    b.get_by_role('button',name='确认应用模板变更',exact=True).click()
    expect(b.get_by_role('button',name='读取当前生成结果',exact=True)).to_be_visible(timeout=20000)
    expect(b.get_by_text('Core 已确认该计划完成绑定，无需恢复。',exact=True)).to_be_visible(timeout=20000)
    assert context.request.get(base+'/control').json()['plan']['originalOperationId']!=original
    context.request.get(base+'/control?child=completed')
    b.get_by_role('button',name='读取当前生成结果',exact=True).click()
    expect(b.get_by_text('本次读取：已生成',exact=False)).to_be_visible()
    expect(b.get_by_text('这是历史记录，不代表当前生成进度。',exact=True)).to_be_visible()
    context.request.get(base+'/control?failDerived=1')
    b.get_by_role('button',name='读取当前生成结果',exact=True).click()
    expect(b.get_by_text('当前生成状态读取失败或尚无结果；上次记录不能代替本次结果。',exact=True)).to_be_visible()
    expect(b.get_by_text('本次读取：已生成',exact=False)).to_have_count(0)
    b.screenshot(path=os.path.join(artifacts,'derived-current-failure.png'))
    b.get_by_label('此 Bank 的 Taki 模板').select_option('none')
    b.get_by_role('button',name='预览模板变更',exact=True).click()
    expect(b.get_by_role('button',name='确认应用模板变更',exact=True)).to_be_disabled()
    b.get_by_role('checkbox',name='我已核对每项删除及其内容、历史和依赖损失',exact=True).check()
    b.get_by_role('button',name='确认应用模板变更',exact=True).click()
    expect(b.get_by_text('已选择模板：无 Taki 贡献',exact=False)).to_be_visible(timeout=20000)
    second.evaluate('window.__remount()')
    expect(b.get_by_label('模板管理范围')).to_be_enabled(timeout=20000)
    b.get_by_label('模板管理范围').select_option(bank_ids[0])
    expect(b.get_by_label('记忆提取重点模式')).to_have_value('value')
    expect(b.get_by_label('记忆提取重点自定义值')).to_have_value(template_text)
    expect(b.get_by_text('Home user model · 独立自定义值',exact=True)).to_be_visible()
    assert not errors,errors
    final=context.request.get(base+'/control').json()
    assert final['submits']==4,final
    print(json.dumps({'verdict':'TEMPLATE_HOME_PASS','browserExecutable':chromium,'browserVersion':browser.version,'submits':final['submits'],'originalOperationId':original,'twoObservers':True,'lostAck':True,'initiatorClosedDuringPartial':True,'reconnect':True,'remount':True,'explicitEqualValueSurvivesRemoval':True,'unsavedFormBlocksPreview':True,'unsavedFormSurvivesReconnect':True,'escapeFromDetailsRestoresFocus':True,'derivedFailureClearsSuccess':True,'pageErrors':errors}))
    context.close();browser.close()
`;
