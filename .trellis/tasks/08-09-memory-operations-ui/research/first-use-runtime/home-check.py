"""Exercise actual Home pages against the owned Core/Native fixture; credentials arrive on stdin."""
import json
import os
import sys
import time
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

cfg = json.loads(sys.stdin.readline())
errors = []
template_replies = []
rpc_timings = []


def observe_templates(socket):
    if urlsplit(socket.url).netloc == urlsplit(cfg["url"]).netloc:
        return  # Vite's HMR socket is not the authenticated Core RPC connection.
    pending = {}

    def sent(payload):
        message = json.loads(payload)
        if message.get("method") in ("memory.templates.preview", "memory.templates.preview.bank", "memory.authority.status", "memory.transitions.overview",
                                     "memory.activation.status", "memory.onboarding.status", "memory.templates.status", "memory.hindsight.configuration.status",
                                     "config.list", "memory.replica.configure"):
            timing = {"method": message["method"], "sentAt": round(time.time() * 1000), "elapsedMs": None, "rpcError": None}
            rpc_timings.append(timing)
            if message["method"] == "memory.replica.configure":
                timing["bankId"] = message["params"]["bankId"]
            pending[message["id"]] = (timing, time.monotonic())

    def received(payload):
        message = json.loads(payload)
        sent = pending.pop(message.get("id"), None)
        if sent:
            timing, started = sent
            method = timing["method"]
            timing.update(elapsedMs=round((time.monotonic() - started) * 1000), rpcError=message.get("error", {}).get("code"))
            if method in ("memory.templates.preview", "memory.templates.preview.bank"):
                template_replies.append((method, message.get("result")))

    socket.on("framesent", sent)
    socket.on("framereceived", received)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=cfg["chromium"], headless=True)
    context = browser.new_context(viewport={"width": 1250, "height": 1100})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("websocket", observe_templates)
    page.set_default_timeout(30000)
    page.goto(cfg["url"])

    def card(title, target=page):
        return target.locator("section").filter(has=target.get_by_role("heading", name=title, exact=True))

    def click(scope, label, timeout=30000):
        button = scope.get_by_role("button", name=label, exact=True)
        expect(button).to_be_enabled(timeout=timeout)
        button.click()

    def wait_operation(kind, previous, *, deadline=None, allow_backup_busy=False):
        # Observe the actual shared operation subscription. Extra full authority polling would contend
        # with synchronous transition proof validation and would not model the Home controller.
        if deadline is None:
            deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            operation = page.evaluate("({kind, previous}) => window.__operation(kind, previous)", {"kind": kind, "previous": previous})
            if operation is not None:
                busy = (allow_backup_busy and kind == "backup.capture" and operation["state"] == "failed"
                        and operation.get("errorCode") == "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT"
                        and operation.get("producer", {}).get("phase") == "quiescing" and operation.get("result") is None)
                assert operation["state"] == "completed" or busy, {key: operation.get(key) for key in ("operationId", "kind", "state", "errorCode", "result")}
                return operation
            page.wait_for_timeout(250)
        raise AssertionError(f"operation did not reach a terminal state: {kind}")

    try:
        expect(page.get_by_role("heading", name="记忆权威 / Hindsight 运维", exact=True)).to_be_visible(timeout=120000)
        action = cfg["action"]
        if action == "onboard":
            local = card("本地记忆引导")
            click(local, "预览本地来源")
            click(local, "准备本地记忆")
            click(local, "启用本地记忆", 120000)
            expect(local.get_by_text("本地记忆运行时可用。可直接使用本地记忆；有待恢复来源时，请执行来源恢复。", exact=True)).to_be_visible(timeout=120000)
        elif action == "setup":
            # Fresh Home must expose validation before any direct setup RPC has been submitted.
            activation = card("启用 Hindsight")
            expect(activation.get_by_role("button", name="校验连接", exact=True)).to_be_enabled()
            click(page, "设置页")
            field = page.get_by_label("Hindsight API Key", exact=True)
            expect(field).to_be_enabled()
            field.fill(cfg["apiKey"])
            click(page, "保存 API Key")
            expect(field).to_have_value("")
            click(page, "清除 API Key")
            expect(page.get_by_text("尚未保存 API Key。", exact=True)).to_be_visible()
            field.fill(cfg["apiKey"])
            click(page, "保存 API Key")
            expect(field).to_have_value("")
            endpoint = page.get_by_label("TAKI_HINDSIGHT_ENDPOINT", exact=True)
            endpoint.fill(cfg["endpoint"])
            endpoint.press("Tab")
            # The config row is the closest ancestor carrying its editor; avoid the enclosing group.
            row = page.get_by_text("TAKI_HINDSIGHT_ENABLED", exact=True).locator("xpath=../../..")
            row.get_by_role("checkbox").click()
            expect(row.get_by_role("checkbox")).to_be_checked()
            expect(row.get_by_text("保存中…", exact=True)).to_have_count(0)
            page.screenshot(path=os.path.join(cfg["artifacts"], "key-settings.png"), full_page=True)
            click(page, "运维页")
            activation = card("启用 Hindsight")
            click(activation, "校验连接")
            click(activation, "应用配置", 120000)
            expect(activation.get_by_role("button", name="启用 Hindsight", exact=True)).to_be_enabled(timeout=180000)
        elif action == "activate":
            activation = card("启用 Hindsight")
            click(activation, "启用 Hindsight")
            expect(card("记忆权威 / Hindsight 运维").get_by_role("button", name="立即同步", exact=True).first).to_be_enabled(timeout=600000)
        elif action == "template":
            template = card("Hindsight 模板与用户定制")
            expect(template.get_by_role("button", name="预览模板变更", exact=True)).to_be_enabled()
            # This enrollment step deliberately covers v2; the following registered apply selects latest.
            template.get_by_label("全局模板默认版本", exact=True).select_option("taki-bank-v2")
            template.get_by_label("角色模板默认版本", exact=True).select_option("taki-bank-v2")
            status = page.evaluate("window.__status()")
            banks = {bank["nativeBankId"]: bank for bank in status["hindsight"]["banks"]}
            assert status["runtime"]["available"] and banks and None not in banks
            checkpoints = {bank["bankId"]: bank["checkpoint"] for bank in status["replica"]}
            targets = {bank_id: {"bank_id": bank_id, "provider_lineage": status["authority"]["providerLineageId"],
                                "bank_generation": checkpoints[bank_id]["bankGeneration"]} for bank_id in banks}
            scope = template.get_by_label("模板管理范围", exact=True)
            expect(scope).to_have_value("")
            expect(scope.locator("option")).to_have_count(len(banks) + 1)
            reviewed = {}
            region = template.get_by_role("region", name="模板变更预览", exact=True)
            conflict = template.get_by_text("现有资源需要核对后重新预览；不会自动接管或删除。多个同名资源必须先解决歧义。", exact=True)
            # Defaults preview stops at the first refused Bank; each UI choice must advance to another Bank.
            for _ in range(len(banks) + 1):
                start = len(template_replies)
                click(template, "预览模板变更")
                expect(conflict.or_(region)).to_be_visible(timeout=120000)
                replies = [reply for method, reply in template_replies[start:] if method == "memory.templates.preview"]
                assert len(replies) == 1 and replies[0], "missing authenticated preview response"
                preview = replies[0]
                if preview["state"] == "ready":
                    break
                assert preview["state"] == "refused" and preview["reason"] == "MEMORY_TEMPLATE_CONFLICT"
                review = preview["review"]
                assert review is not None, "refusal has no authenticated before-image"
                bank_id = review["target"]["bank_id"]
                assert bank_id in banks and bank_id not in reviewed, "unexpected or repeated conflict Bank"
                assert preview["bankId"] == bank_id and review["target"] == targets[bank_id]
                assert len(review["directives"]) == 1, "unexpected fixture directive inventory"
                directive = review["directives"][0]
                assert directive["name"] == f"taki-{banks[bank_id]['scope']}-memory-policy-v1"
                assert len(directive["name_matches"]) == 1, "ambiguous or missing existing directive"
                candidate = directive["name_matches"][0]
                assert directive["definition"] is None and directive["id"] != candidate
                reviewed[bank_id] = {"target": review["target"], "name": directive["name"], "id": candidate}
                expect(template.get_by_role("button", name="选择此现有指令并重新核对", exact=True)).to_have_count(1)
                click(template.get_by_text(candidate, exact=False), "选择此现有指令并重新核对")
            else:
                raise AssertionError("template preview did not finish after reviewing every Bank")
            assert set(reviewed) == set(banks), "initial v1 enrollment did not cover every fixture Bank"
            assert preview["changesDefaults"] and len(preview["banks"]) == len(banks)
            summaries = {bank["target"]["bank_id"]: bank for bank in preview["banks"]}
            assert set(summaries) == set(banks)
            expect(region.get_by_role("article")).to_have_count(len(banks), timeout=120000)
            details = [reply for method, reply in template_replies if method == "memory.templates.preview.bank"
                       and reply and reply["previewId"] == preview["previewId"]]
            assert len(details) == len(banks) and {detail["bank"]["target"]["bank_id"] for detail in details} == set(banks)
            for detail in details:
                bank_id = detail["bank"]["target"]["bank_id"]
                summary = summaries[bank_id]
                assert detail["previewHash"] == preview["previewHash"] and detail["bank"] == summary
                assert summary["target"] == targets[bank_id] and detail["before"]["target"] == targets[bank_id]
                assert summary["templateRevision"] == "taki-bank-v2" and summary["enrollment"] == "reviewed-existing"
                assert summary["deletions"] == summary["refreshChildren"] == 0
                assert not detail["deletions"] and not detail["refresh"], "unexpected deletion or provider work"
                before = detail["before"]["directives"]
                chosen = reviewed[bank_id]
                assert len(before) == 1 and before[0]["id"] == chosen["id"] and before[0]["name"] == chosen["name"]
                assert before[0]["name_matches"] == [chosen["id"]] and before[0]["definition"]["id"] == chosen["id"]
            expect(region.get_by_role("checkbox")).to_have_count(1)
            expect(region.get_by_role("button", name="确认应用模板变更", exact=True)).to_be_disabled()
            region.get_by_label("我已核对现有值和资源身份，同意按此预览接管或重新协调", exact=True).check()
            with open(os.path.join(cfg["artifacts"], "template-review.json"), "w", encoding="utf-8") as out:
                json.dump({"reviewed": reviewed, "previewId": preview["previewId"], "previewHash": preview["previewHash"],
                           "completeBankDetails": len(details), "deletions": 0, "refreshChildren": 0}, out, indent=2)
            click(template, "确认应用模板变更", 120000)
            expect(template.get_by_text("Core 已确认该计划完成绑定，无需恢复。", exact=True)).to_be_visible(timeout=300000)
        elif action == "backup":
            status = page.evaluate("window.__status()")
            previous = [row["operationId"] for row in status["operations"]["recent"]]
            capture_deadline = time.monotonic() + 600
            attempts = []
            while time.monotonic() < capture_deadline:
                click(card("记忆权威 / Hindsight 运维"), "创建备份")
                captured = wait_operation("backup.capture", previous, deadline=capture_deadline, allow_backup_busy=True)
                attempts.append({key: captured.get(key) for key in ("operationId", "state", "errorCode", "producer", "result")})
                with open(os.path.join(cfg["artifacts"], "backup-attempts.json"), "w", encoding="utf-8") as out:
                    json.dump(attempts, out, indent=2)
                if captured["state"] == "completed":
                    break
                # Model an operator using the existing action after the explicit, artifact-free busy refusal.
                expect(card("记忆权威 / Hindsight 运维").get_by_text("已有记忆处理尚未结束，本次未创建备份；请稍后再次点击“创建备份”", exact=False)).to_be_visible()
                previous.append(captured["operationId"])
            else:
                raise AssertionError("backup did not recover within the original capture observation budget")
            assert captured["result"]["verifiedAt"] and captured["result"]["mismatch"] is None
            click(card("记忆权威 / Hindsight 运维"), "校验备份")
            verified = wait_operation("backup.verify", previous)
            assert verified["result"]["backupId"] == captured["result"]["backupId"]
            assert verified["result"]["verifiedAt"] and verified["result"]["mismatch"] is None
        elif action in ("return-local", "reenter-hindsight", "emergency-local"):
            labels = {"return-local": "返回 Local", "reenter-hindsight": "重新进入 Hindsight", "emergency-local": "紧急接管至 Local"}
            status = page.evaluate("window.__status()")
            previous = [row["operationId"] for row in status["operations"]["recent"]]
            transitions = card("记忆模式切换与恢复")
            click(transitions, "预览" + labels[action], 120000)
            confirmation = transitions.get_by_role("region", name="确认：" + labels[action], exact=True)
            expect(confirmation).to_be_visible(timeout=120000)
            if action == "emergency-local":
                expect(confirmation.get_by_text("紧急接管只使用本机保全证据。远端最新状态及可能丢失的区间未知；游标相等也不能证明没有丢失。", exact=True)).to_be_visible()
                expect(confirmation.get_by_text("已验证备份距证据采集约", exact=False)).to_be_visible()
                for label in ("副本 / 应用原生游标", "应用状态游标", "待处理写入", "备份原生 / 应用状态游标"):
                    expect(confirmation.get_by_text(label, exact=True)).to_have_count(len(status["hindsight"]["banks"]))
            confirmation.screenshot(path=os.path.join(cfg["artifacts"], "confirmation.png"))
            click(transitions, "确认紧急接管" if action == "emergency-local" else "确认切换", 120000)
            operation = wait_operation("transition." + action, previous)
            assert operation["result"]["authorityCommitted"] and operation["result"]["runtime"] == "ready"
            assert operation["result"]["queue"] == "settled"
            # Completion pushes trigger asynchronous status reads with the actual 15s UI RPC deadline.
            # Keep that product deadline and the error-DOM assertions; Playwright's implicit 5s is not the contract.
            expect(transitions.get_by_text(labels[action] + " · 已完成", exact=True)).to_be_visible(timeout=15000)
            authority_card = card("记忆权威 / Hindsight 运维")
            expect(authority_card.get_by_text("运行时可用", exact=True)).to_be_visible()
            expect(authority_card.get_by_text("无进行中的操作。", exact=True)).to_be_visible()
            # Each card finishes its own coalesced read after the completion push.
            # A prior timeout remains visible during that read; require it to clear within the real read deadline.
            expect(page.locator("body")).not_to_contain_text("request exceeded", timeout=15000)
            expect(page.locator("body")).not_to_contain_text("读取超时", timeout=15000)
            expect(page.get_by_text("正在等待最新状态，操作暂不可用。", exact=True)).to_have_count(0, timeout=15000)
        elif action == "sync":
            second = context.new_page()
            second.goto(cfg["url"])
            mode = page.get_by_label("后台同步模式", exact=True).first
            expect(mode).to_be_enabled()
            mode.select_option("manual")
            page.get_by_label("增量同步间隔单位", exact=True).first.select_option("minutes")
            page.get_by_label("增量同步间隔", exact=True).first.fill("17")
            page.get_by_label("完整对账间隔", exact=True).first.fill("3")
            page.get_by_label("完整对账间隔单位", exact=True).first.select_option("days")
            page.get_by_role("button", name="保存同步设置", exact=True).first.click()
            expect(second.get_by_label("后台同步模式", exact=True).first).to_have_value("manual")
            expect(second.get_by_label("增量同步间隔", exact=True).first).to_have_value("17")
            expect(second.get_by_label("完整对账间隔", exact=True).first).to_have_value("3")
            for label in ["立即同步", "完整对账"]:
                previous = [row["operationId"] for row in page.evaluate("window.__status()")['operations']['recent']]
                button = page.get_by_role("button", name=label, exact=True).first
                expect(button).to_be_enabled()
                button.click()
                wait_operation("replica.sync", previous)
            second.screenshot(path=os.path.join(cfg["artifacts"], "second-home-updated.png"), full_page=True)
            second.close()
        elif action == "sync-observation":
            expected = cfg["observation"]
            status = page.evaluate("window.__status()")
            index = next(i for i, bank in enumerate(status["replica"]) if bank["bankId"] == expected["bankId"])
            bank = status["replica"][index]
            for key in ("lastAttemptAt", "lastSuccessAt", "errorCode"):
                assert bank[key] == expected[key], {"field": key, "expected": expected[key], "actual": bank[key]}
            block = card("记忆权威 / Hindsight 运维").get_by_label("后台同步模式", exact=True).nth(index).locator("xpath=ancestor::div[./dl][1]")
            for label, value in (("上次尝试", bank["lastAttemptAt"]), ("上次成功", bank["lastSuccessAt"]), ("错误", bank["errorCode"] or "无")):
                expect(block.locator("dt").filter(has_text=label).locator("xpath=following-sibling::dd")).to_have_text(value)
            page.screenshot(path=os.path.join(cfg["artifacts"], "sync-observation.png"), full_page=True)
            # A read-only page navigation remains usable while the failed attempt is displayed.
            click(page, "设置页")
            expect(page.get_by_label("Hindsight API Key", exact=True)).to_be_enabled()
            click(page, "运维页")
            expect(block.locator("dt").filter(has_text="上次成功").locator("xpath=following-sibling::dd")).to_have_text(bank["lastSuccessAt"])
            with open(os.path.join(cfg["artifacts"], "sync-observation.json"), "w", encoding="utf-8") as out:
                json.dump({key: bank[key] for key in ("bankId", "lastAttemptAt", "lastSuccessAt", "errorCode")}, out, indent=2)
        elif action == "reopen":
            expect(card("记忆权威 / Hindsight 运维").get_by_role("button", name="立即同步", exact=True).first).to_be_enabled()
            expect(page.get_by_label("后台同步模式", exact=True).first).to_have_value("manual")
            expect(page.get_by_label("增量同步间隔", exact=True).first).to_have_value("17")
            page.evaluate("window.__reconnect()")
            expect(card("记忆权威 / Hindsight 运维").get_by_role("button", name="立即同步", exact=True).first).to_be_enabled()
        elif action == "sync-during-home":
            page.set_default_timeout(15000)

            def wait_replies(method, offset):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    replies = [row for row in rpc_timings[offset:] if row["method"] == method]
                    if replies and all(row["elapsedMs"] is not None for row in replies):
                        assert all(row["rpcError"] is None and row["elapsedMs"] < 15000 for row in replies), replies
                        return replies
                    page.wait_for_timeout(25)
                raise AssertionError(f"Home Core RPC did not reply within 15s: {method}")

            initial = page.evaluate("window.__status()")
            index = next(i for i, bank in enumerate(initial["replica"]) if bank["bankId"] == cfg["observation"]["bankId"])
            expect(page.get_by_label("增量同步间隔", exact=True).nth(index)).to_be_enabled()
            print("HOME_INTERACTION_READY", flush=True)
            held = json.loads(sys.stdin.readline())
            before = page.evaluate("window.__status()")
            bank = next(bank for bank in before["replica"] if bank["bankId"] == held["bankId"])
            assert bank["run"]["lease"]["runId"] == held["runId"], bank
            assert any(row["operationId"] == held["operationId"] and row["state"] == "running"
                       for row in before["operations"]["active"]), before["operations"]
            timing_offset = len(rpc_timings)
            started = time.monotonic()
            click(page, "设置页", 15000)
            expect(page.get_by_label("Hindsight API Key", exact=True)).to_be_enabled(timeout=15000)
            # A fresh config.list reply is required: a rendered label or cached form alone proves no Core progress.
            reads = wait_replies("config.list", timing_offset)
            click(page, "运维页", 15000)
            interval = page.get_by_label("增量同步间隔", exact=True).nth(index)
            expect(interval).to_be_enabled(timeout=15000)
            page.get_by_label("增量同步间隔单位", exact=True).nth(index).select_option("minutes")
            interval.fill(str(cfg["observation"]["intervalMinutes"]))
            page.get_by_role("button", name="保存同步设置", exact=True).nth(index).click()
            writes = wait_replies("memory.replica.configure", timing_offset)
            assert len(writes) == 1 and writes[0]["bankId"] == held["bankId"], writes
            after = page.evaluate("window.__status()")
            saved = next(bank for bank in after["replica"] if bank["bankId"] == held["bankId"])
            assert saved["autoIntervalMs"] == cfg["observation"]["intervalMinutes"] * 60000, saved
            assert saved["run"]["lease"]["runId"] == held["runId"], saved
            assert any(row["operationId"] == held["operationId"] and row["state"] == "running"
                       for row in after["operations"]["active"]), after["operations"]
            elapsed_ms = round((time.monotonic() - started) * 1000)
            assert elapsed_ms < 45000, {"interactionMs": elapsed_ms}
            with open(os.path.join(cfg["artifacts"], "sync-during-home.json"), "w", encoding="utf-8") as out:
                json.dump({"held": held, "before": bank, "after": saved, "interactionMs": elapsed_ms,
                           "rpcTimings": rpc_timings[timing_offset:]}, out, indent=2)
        else:
            raise ValueError("unknown Home phase")
        page.screenshot(path=os.path.join(cfg["artifacts"], "complete.png"), full_page=True)
        assert not errors, errors
        print(json.dumps({"action": action, "status": "passed", "pageErrors": errors}))
    except Exception:
        # Password inputs are masked; never export the DOM/input values or trace request bodies.
        page.screenshot(path=os.path.join(cfg["artifacts"], "failure.png"), full_page=True)
        with open(os.path.join(cfg["artifacts"], "page-error.json"), "w", encoding="utf-8") as out:
            json.dump({"errors": errors, "body": page.locator("body").inner_text()}, out, ensure_ascii=False, indent=2)
        raise
    finally:
        with open(os.path.join(cfg["artifacts"], "rpc-timings.json"), "w", encoding="utf-8") as out:
            json.dump(rpc_timings, out, indent=2)
        browser.close()
