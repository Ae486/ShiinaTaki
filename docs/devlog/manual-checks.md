# 人工验收清单（排队中）

> 需要你的眼睛/双手的验收项。验完打勾即可；发现问题直接在条目下写一行，我会开返工轮。

## 来自脚手架（issue #2，遗留）

- [x] **Tauri IPC 冒烟**：运行 `pnpm desktop:dev`，窗口打开后点击 "Check IPC" 按钮，应显示 Rust 侧回包（验证 Tauri 命令通路）。约 1 分钟。 —— 已验（2026-07-10，用户手测返回 `IPC ok: pong / hello`，与 `lib.rs` ping 命令输出一致）。

## 来自 M1（#3/#4/#5）

（无——全部已由自动化测试与主脑真实冒烟覆盖）

## 来自 M3 #10（Rust Shell + 权限门 + 截图能力）

> 机器可验部分主脑已全绿：389 TS + 17 Rust 测试、clippy 零警告、能力回路/门策略/审计/协议镜像全覆盖，check（fable）零缺陷通过。以下是单测里用 fake 注入、只能真机验证的活线层——原生弹窗、真实 xcap 截屏、Windows 凭据管理器。约 5-8 分钟走完全程。

**准备**：一个终端裸 node 直启 core（先 `netstat -ano | grep 8974` 查杀残留）：
```
cd packages/core
node --env-file-if-exists=../../.env.local src/main.ts
```
另一个终端启 Shell：`pnpm --filter @taki/desktop tauri dev`；再一个终端启 CLI：`cd apps/cli && node src/main.ts`（对 taki 聊天用）。

- [ ] **1. 配对面板**：Shell 窗口打开后应显示状态 + 配对码输入框（不再是 Check IPC 按钮）。从 core 控制台读 6 位配对码填入 → 状态变 `connected`。
- [ ] **2. 首次截图 + 两步弹窗**：在 CLI 让模型截图（如"帮我截个屏"）→ Shell 弹「Allow screenshot? [Allow][Deny]」→ 点 **Allow** → 再弹「Remember? [Only once][This session][Always]」→ 选 **Only once** → `~/.takiagent/workspace/screenshots/` 落一张 PNG，模型回报路径 + 尺寸。
- [ ] **3. 会话记忆**：再次让模型截图 → 选 **This session** → 之后同类请求**不再弹窗**直接执行。
- [ ] **4. 重启清会话**：关掉 Shell 窗口重开并重连 → 再截图应**重新弹窗**（session 授权随 Shell 进程清空）。
- [ ] **5. 永久授权跨重启**：某次弹窗选 **Always** → 关 Shell 重开重连 → 再截图**不弹窗**（持久化生效，落在 `%APPDATA%\cc.shiinataki.app\gate-decisions.json`）。
- [ ] **6. 拒绝路径**：某次弹窗点 **Deny** → 模型应优雅报告被拒，不崩、不挂。
- [ ] **7. 凭据落地**：打开 Windows 凭据管理器（`控制面板 → 凭据管理器 → Windows 凭据`）→ 应有 `TakiAgent` 相关条目（node-token 与 device-id）。
- [ ] **8. 断连重连**：Ctrl+C 杀掉 core → Shell 状态变 disconnected 并进入重连循环 → 重启 core → Shell **免配对自动重连**。
- [ ] **9. 审计文件**：查看 `%APPDATA%\cc.shiinataki.app\audit.jsonl` → 每次决定一行，字段仅 `ts / requestId / capability / decision`（如 `allowed-once` / `allowed-session` / `denied`），**无图像内容、无路径**。

发现任何问题在对应条目下写一行，我开返工轮。截图落盘的实际路径若与上面不符，以 core 控制台日志为准。

## 来自 M3 #11（类型化能力：进程列表 / 剪贴板 / shell-open / 工作区文件）

> 机器可验部分主脑已全绿：438 TS + 26 Rust 测试、clippy 零警告，check（fable）修复 2 项内容泄漏/契约缺陷后通过。工作区文件的逃逸拒绝、进程列表、剪贴板往返可在 CLI 里直接验；shell-open 的**弹窗目标可见性 + 真实启动**需真机看。沿用 #10 的三终端启动方式（core 裸 node + Shell tauri dev + CLI）。

- [ ] **10. shell-open + 弹窗显目标**：CLI 让模型"打开 https://example.com" → Shell 弹窗应**逐字显示 `open https://example.com`**（不只是能力名）→ Allow → 浏览器打开该页。这是安全关键:用户必须看清开的是什么再批。
- [ ] **11. shell-open 拒绝危险 scheme**：让模型"打开 javascript:alert(1)" 或 "打开 file:///C:/Windows" → 应被拒（`unsupported url scheme`），**不启动任何东西**,模型收到结构化错误。
- [ ] **12. 剪贴板往返**：让模型"把 hello-taki 写入剪贴板" → 弹窗 Allow → 手动 Ctrl+V 到记事本应出现 `hello-taki`；再让模型"读剪贴板" → Allow → 模型回报该内容。
- [ ] **13. 进程列表**：让模型"列出正在运行的进程" → 弹窗 Allow → 模型返回进程快照（pid/名称/内存),**不含命令行 argv**（隐私:v1 故意排除)。
- [ ] **14. 工作区文件读写**：让模型"在工作区写一个 notes.txt,内容 hello" → **不弹窗**（工作区是 agent 自己的空间,自动允许)→ `~/.takiagent/workspace/` 下出现 notes.txt；再让模型"读 notes.txt" → 回报 hello。
- [ ] **15. 路径逃逸被拒（安全核心）**：让模型"读取 ../../../Windows/System32/drivers/etc/hosts"（或任意工作区外路径) → 应被拒(`OUTSIDE_WORKSPACE`/`INVALID_PATH`),模型收到结构化错误,**不泄露绝对路径**,不读到任何工作区外文件。

发现任何问题在对应条目下写一行，我开返工轮。

## 来自 M3 #12（exec 能力 + 完整治理管线）

> 机器可验部分主脑 + fable check 双验全绿：444 TS + 59 Rust 测试、clippy 零警告，含 3 个真实 Windows spawn 测试(exit0/超时杀/截断杀)。以下需真机看**弹窗是否逐字显示命令原文**(安全关键)+ 实际执行效果。沿用三终端启动。默认策略 = allowlist 模式、**allowlist 为空**(未配置 `exec-policy.json` 前一切命令都会弹窗),要测"自动跑"需先在 `%APPDATA%\cc.shiinataki.app\exec-policy.json` 写 `{"mode":"allowlist","allowlist":["git","hostname"]}` 之类。

- [ ] **16. 简单允许命令自动跑**：配好 allowlist 含 `hostname` → 让模型"运行 hostname" → **不弹窗**直接执行 → 模型回报机器名 + exitCode 0。(验 allowlist 自动放行)
- [ ] **17. 非白名单命令弹窗显示原文**：让模型"运行 whoami"(不在 allowlist)→ Shell 弹窗应**逐字显示 `whoami`**(不只是"exec")→ Allow → 执行并回报。这是安全关键:用户必须看清跑的是什么命令再批。
- [ ] **18. 链式/重定向命令升级审批**：让模型"运行 `git status && del x`" 或含 `>` 重定向 → 应弹窗(不自动跑,即便 git 在 allowlist)→ 弹窗显示完整命令串。
- [ ] **19. 灾难命令直拒不弹窗**：让模型"运行 `rm -rf /` 或 `format c:`" → **不弹窗直接拒**,模型收到结构化 DENIED,不执行任何东西。
- [ ] **20. 超时**：让模型运行一个长任务(如 `ping -n 60 127.0.0.1`,需先 allowlist 或走 Allow)→ 约 30s 后应被杀,模型收到 `timedOut:true`、exitCode null,不永久挂起。
- [ ] **21. 工作区 cwd**：让模型运行能打印当前目录的白名单命令 → 确认执行目录是 `~/.takiagent/workspace`(单机默认),非随机目录。
- [ ] **22. 审计记命令**：跑几条 exec 后看 `%APPDATA%\cc.shiinataki.app\audit.jsonl` → exec 的行应含 `command` 字段(命令原文),其余能力(截图/剪贴板)的行**无** command 字段。
发现任何问题在对应条目下写一行，我开返工轮。

## 来自 #13（Live2D 渲染器选型 spike）

> **状态更新（2026-07-13）**：原 24-30 与"决定"项已由主脑的无头浏览器采证覆盖（headless Edge/CDP，与 WebView2 同内核；全部探针 PASS，决策 LOCK 已写回 `docs/TECH-STACK.md`，证据在任务 `research/` 目录，截图经主脑目视核验）。但无头跑在 **SwiftShader 软件渲染**上——真实 GPU 下的视觉正确性与空闲开销仍需你手测，即下方 31/32 两项。约 3 分钟。

**跑法**：仓库根目录 `pnpm --filter @taki/desktop dev`（只起 Vite，不需要 Tauri）→ 用 Edge/Chrome 打开 **http://localhost:1420/spike.html**（桌面浏览器默认硬件 GPU 加速，内核与 WebView2 一致）。验完 Ctrl+C 关掉 dev server。左侧画布应并排出现两个 taki 模型（左 Cubism 2 arbeit，右 Cubism 3+ live_01）。

- [x] ~~24. moc + moc3 双双加载~~ —— 无头采证覆盖（`loaded.ok` 双 true）
- [x] ~~25. 动作播放~~ / ~~26. 表情切换~~ / ~~27. 命中测试~~ / ~~28. 参数往返~~ / ~~29. 口型 API~~ —— 无头采证全部 PASS；hitTest 双双返回 `[]` 坐实 #16 需自建命中区（`runtime-evidence.md`）
- [x] ~~30. 取景/缩放读数~~ —— 无头采证：两代 layout-scale 均 1.0，暂不需要 BANDORI 式 1.35x 补偿（#14 复核）
- [x] **31. 空闲开销（GPU 真值）**：用户实测 2026-07-13 —— 静置 CPU ≈ **89%**（Chromium 单标签按单核计，≈吃满一核），内存 ≈ 207MB。偏高但**符合预期、非缺陷**：spike 无帧率调控器（PixiJS 默认满帧无脑重绘两模型，其一为 4.5MB moc3）。此为 #14 帧率调控器（动画全帧/待机降帧/离屏停渲）的**基线参考值**，做完后应大幅下降。GPU 列用户浏览器未显示，略。
- [x] **32. GPU 渲染目视**：用户确认 2026-07-13 —— 两模型完整渲染、有轻微呼吸晃动、无花屏破面、面板全 PASS、DECISION=LOCK。**眨眼未见（正确）**：spike harness 只做一次性探针 + `autoInteract:false`，未启用 EyeBlink/待机循环；眨眼自动化属 #14 待机状态机，spike 不含。呼吸是模型内建 idle 参数，渲染即有。
- [x] ~~决定~~ —— 已执行：`decision` = LOCK，`untitled-pixi-live2d-engine@1.3.1` + `pixi.js@8.19.0` 已写回 `docs/TECH-STACK.md` 渲染器决策段

> 真实 Tauri WebView2 窗口内的最终确认不在此处单验——#14 落地悬浮窗时渲染器直接跑在 WebView2 里，自然覆盖。

发现任何问题在对应条目下写一行，我开返工轮。
