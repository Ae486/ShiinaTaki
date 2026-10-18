import json, os, sys
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
