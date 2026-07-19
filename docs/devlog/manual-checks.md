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

## 来自 #14（宠物悬浮窗：透明 / 待机 / 状态机 / 拖拽）

> 机器可验部分主脑 + check 双验全绿：desktop typecheck / -w lint / 11 前端测试（FSM 转换 + governor 暂停断言）/ -r typecheck / cargo build 全过；renderer/ 零 React 导入、位置持久化纯 Rust 侧不过 WS、能力文件权限齐备均已核。以下是**必须真机看**的活线层——透明合成、Win11 边框、真实动画、拖拽手感只能人眼验。约 3-5 分钟。

**跑法**：仓库根 `pnpm --filter @taki/desktop tauri dev`（起 Tauri，pet 窗口应自动出现；main 配对窗也会开——D20 已登记，属预期）。

- [ ] **33. 透明合成**：pet 窗口应是**逐像素透明**——只有 taki 小人可见，周围无白底/灰底/方框，能看到桌面。若小人周围有不透明背景块 → 透明失败。
- [ ] **34. 无 Win11 边框（决定 DWM 是否要补）**：`shadow:false` 下窗口应**无圆角、无 1px 白边**。若仍有残留圆角/白边 → 在此写一行，我补 DWM 抑制（D18/研究 05 已备方案：`windows="0.61"` + DONOTROUND + BORDER_COLOR NONE）。
- [ ] **35. 待机动画可见**：taki 应**看得见地眨眼 + 呼吸起伏**（spike 时眨眼没跑，本次已显式绑定 governed ticker + eyeBlink:true + 循环 idle 动作——需真机确认真的动起来）。
- [ ] **36. 拖拽手感 + 死区**：拖 taki 应带动整个窗口移动；轻点（<4px 移动）应算点击不触发拖拽（为 #16 点击留通路）；OS 拖拽后 pointerup 行为正常，不卡住。
- [ ] **37. 位置持久化**：拖到某处 → 关掉 app 重开 → pet 窗口应**回到上次位置**（tauri-plugin-window-state，POSITION-only，仅 pet 窗）。
- [ ] **38. 不抢焦点 + 无白闪**：启动时 pet 窗口不应抢走当前程序的焦点（`focus:false`）；`visible:false`→首帧后 show 应**无白屏一闪**。
- [ ] **39. 待机 CPU（governor 真值）**：pet 窗口静置后看任务管理器，记录待机 CPU%——应**明显低于 #13 spike 的约 1 核（≈89%）基线**（governor 生效的证明）。

发现任何问题在对应条目下写一行，我会开返工轮。

## 来自 #15（逐像素点击穿透）

> 机器可验部分主脑 + check 双验全绿：desktop typecheck / -w lint / 21 前端测试（alpha mask 采样器 + toggle 真值表）/ -r typecheck / cargo build 全过；坐标变换（最高风险行）经 check 独立核实正确、两处 deviation 核为 sound、renderer alpha 文件 framework-free、无 windows crate、core/shared 未碰。以下是**必须真机看**的 OS 级穿透行为——无头绝对测不了。约 3-5 分钟。

**跑法**：仓库根 `pnpm --filter @taki/desktop tauri dev`。需要在 pet 窗口后面放一个别的程序（如记事本/浏览器）来测穿透。

- [ ] **40. 小人身上可交互**：鼠标移到 taki **可见身体**上，光标应能"停在"小人上（后续 #16 会加点击响应；此处只验不穿透——把别的窗口拖到 pet 后面，点小人身体不应点到后面的窗口）。
- [ ] **41. 透明处穿透**：点小人**周围的透明区域**，点击应**穿透到底层程序**（如后面记事本能获得焦点/光标）。这是本模块的核心验收。
- [ ] **42. 坐标对齐（关键失败模式）**：穿透/交互的分界应**贴合可见轮廓**——不应出现"小人左边一片明明是透明却点不透"或"小人身上某块却能穿透"的错位。若错位 → 坐标变换或 mask 缩放有问题，写一行我修。
- [ ] **43. 随动画追踪**：小人眨眼/呼吸/动作时轮廓在动，穿透分界应**跟着轮廓走**（每帧刷 mask），不滞后。
- [ ] **44. 拖拽中不漏穿**：拖动小人移动窗口的**全过程**中，不应中途"漏穿"把点击落到后面的程序（拖拽期 toggle 挂起）。
发现任何问题在对应条目下写一行，我会开返工轮。

## 来自 #16 后端（气泡对话 + LLM 驱动表情/动作——后端半）

> 后端半（avatar 工具 + 频道 + 人格注入）机器可验部分已全绿：`@taki/shared` 142 测 + `@taki/core` 369 测（含 avatar-schema 往返、persona-provider 读取/顺序/note-strip/降级、assembler 注入顺序、avatar 订阅扇出 + onClose 清理、vocabulary set/render、avatar 工具 publish、avatar-subscribe/report 方法）、`-r typecheck`（5 项目）、`-w lint` 全过；D1 硬化回合运行时（chat-agent 流循环/持久化/中止）**未触碰**，仅新增模块 + assembler 注入 + main 装配。以下一项是**真实模型行为**，单测注入 fake 无法验，需真机看（前端渲染项随前端半另附）。

- [ ] **46. LLM 主动表达（活模型行为）**：core 接真实 provider，在 CLI（或前端气泡就绪后）对 taki 聊几轮带情绪的话（如夸她、逗她、让她认真做事）→ 观察 core 日志应出现 `avatar expression published` / `avatar motion published`（模型**主动**调用了 `avatar_set_expression`/`avatar_play_motion`），且用的名字落在该模型 manifest 报上来的词表内。这验证的是 assistant-layer 卡片的表达引导 + Option A 词表注入是否真的让模型去 emote——纯 prompt 行为，只能真机看。

## 来自 #16 前端（气泡对话 + 表情/动作消费 + 注视 + 点击反应——前端半）

> 机器可验部分已全绿：desktop typecheck / desktop lint / 61 前端测试（emotion-resolver 模糊匹配、click-regions 7 区分桶、avatar-commands 未知名 no-op 优雅降级、click-reactions 归一化+分区+反应、presentation-gate 就绪门控、ws-client 入站路由 zod 校验、device-identity、model-vocabulary 读词表、gaze 夹取/去抖、chat-bubble store reducer、click-through 真值表含 bubbleOpen）/ `-r typecheck`（5 项目）全过；renderer/ 保持零 React/Tauri/ws 导入，气泡/连接只经 hook 触达 ws-client。（注：`-w lint` 因并发后端任务在 `e2e/src/fixture/with-stack.ts` 的一处 `max-lines-per-function` 而红，与前端无关、属后端 P3 任务范围。）以下全是**必须真机看**的活线层（透明合成 + 真实模型 + 真实 WS 流），无头测不了。沿用 `pnpm --filter @taki/desktop tauri dev` + 裸 node 起 core。

> **⚠️ 前置阻塞（先读）：operator 连接需要信任。** core 的 `connect.ts` 目前对未知设备一律回 `PAIRING_REQUIRED`——**P3「localhost 免配对」尚未在后端落地**（connect.ts 没有 loopback 自动信任）。Pet UI 作为 operator 直连 core，会撞到同一堵墙，而 #16 按 D23 **不做 operator 配对 UI**。所以下面 47-52（凡需真实 WS 的项）在后端补上 loopback 自动信任前**无法端到端验**。两条出路：**(a) 后端在 connect.ts 给回环连接加自动信任（约 5 行，才是 P3 的正解）**；(b) 临时手动信任一次。前端已写成：一旦拿到 token 就复用、后端一旦自动信任 no-token 连接即自动 `connected`（前向兼容，无需改前端）。纯前端项（53 注视、54 点击反应、55 气泡可点）不依赖 WS，可独立验。

- [ ] **47. 点击身体开气泡 + 流式回复**（依赖前置信任）：点 taki **身体**（非头部）→ 顶部应弹出输入框 → 打字发送 → 回复应**逐字流入**上方气泡；`chat.complete` 后气泡停在完整文本。这是 #16 的核心 AC。
- [ ] **48. 气泡↔时间线共享**（依赖前置信任）：气泡发一句 → 另一终端 CLI 对同一 character 拉 history（或直接看 core 时间线）应含这条 user 消息 + assistant 回复（服务端 `timeline.appended` 扇出，气泡不自持久化）。
- [ ] **49. LLM 表情/动作真机可见**（依赖前置信任，配合后端 46）：聊带情绪的话 → 模型应**真的切表情/播动作**（core 日志 published 的名字应在模型上生效）；报错的名字（词表外）应**静默 no-op 不崩**（Option A 第三层）。
- [ ] **50. 表情+气泡同框（presentation gate）**（依赖前置信任）：一次带表情的回复里，表情切换与气泡文字应**一起出现**（v1 就绪=立即）。这验证的是 D21 预留槽的接线；#31 接 TTS 后会变成「音频就绪才一起出」。
- [ ] **51. 断连表现**：Ctrl+C 杀 core → Pet UI 连接状态应转 `disconnected`（v1 **不自动重连** operator，重开 pet 窗口即可；已知限制，非缺陷）。
- [ ] **52. 首次 PAIRING_REQUIRED 不崩**：全新（清 localStorage）启动、core 未信任本设备 → Pet UI 应停在 `pairing-required` 状态而**不崩、不卡死**（气泡发送会优雅报「未连接」）。这验证前置阻塞下的降级。
- [ ] **53. 注视跟随（纯前端，无需 WS）**：鼠标在屏幕上移动 → taki 头/眼应**平滑转向光标**；光标移到很远处头部**不应被拉到边缘**（600px 夹取）；静止时不抖（去抖门）。注视复用 #15 的同一次光标轮询，**零额外 IPC**——顺带看待机 CPU 是否仍明显低于 #13 的约 1 核基线。
- [ ] **54. 点击分区反应（纯前端，无需 WS）**：戳 taki **头部**应出 tsundere 反应（哈？/angry/别过头），**不开气泡**；戳身体各区应各有反应（pui/shame/serious/sigh）。反应名字对不上时静默（arbeit 词表里有 angry/pui/shame/serious/sigh/smile）。
- [ ] **55. 气泡在透明区可点（点击穿透协同）**：气泡开着时，即便输入框压在**透明像素**上也应能点/能打字（bubbleOpen 期间整窗保持可交互）；关掉气泡后透明区应恢复穿透。点输入框不应触发身后的点击反应/再开气泡（事件已 stopPropagation）。

## 来自 #17（完整聊天窗口 + 图片附件）

> 机器可验部分已全绿：shared 158 + cli 18 + desktop 88 + core 440 = **704** 测试、`-r typecheck`（5 项目）、root lint、`desktop build`（chat.html 进 rollup、chat 独立 chunk 打包 markdown 管线）、`cargo check`（capability id 校验）全过。**后端数据路径已由主脑真实 VLM 端到端 smoke 覆盖**（非默认端口真 core + 真 gemini：红色 PNG → deepseek 答"哈？红色。" → timeline image part 落库 → media.get 精确字节往返 → 穿越 ref 拒 FORBIDDEN → 识图描述记忆 `[image] ...red` 真落库 → P3 auto-trust 日志）。下面全是**必须真机看**的前端渲染/滚动/DOM 层（真实 WebView2），无头测不了。注：本轮自动化无头浏览器 smoke 代理早退无产物，故前端真机项转本人工批次（沿用项目"手测后置"惯例）。启动：`pnpm --filter @taki/desktop tauri dev` + 裸 node 起 core（本机 loopback 免配对，P3 已落地，无 #16 的前置信任阻塞）。

- [ ] **56. 开窗 + 连接**：气泡上的 **⤢（展开）**按钮 → 应打开独立聊天窗口（720×800、可缩放、不透明）；再点一次应**聚焦已有窗**而非重复开；窗口应自动连上本机 core（core 日志出现 deviceName `taki-chat` 的 `loopback operator auto-trusted`），无配对弹窗。
- [ ] **57. 历史分页 + 时序**：窗口打开应拉最新一页历史，**按时间正序**（旧→新）渲染，附日期分隔；滚到顶部应**加载更早页并保持滚动位置**（不跳、不重复行）。
- [ ] **58. 文本流式 + 无缝落定**：发一句 → assistant 回复应**逐字流入** in-flight 气泡 → `chat.complete`/`appended` 后**无缝**变成持久化行（**不闪、不重复**两条）。这是 in-flight（按 messageId）→ persisted（按 seq）原子换行的核心。
- [ ] **59. Markdown 渲染 + XSS 惰化**：让 taki 回一段含**表格 / 粗体 / 行内 code / 链接**的 markdown → 应渲染成真 `<table>`/`<strong>`/`<code>`/`<a>`；构造含 `<script>`、`<img onerror>`、`[x](javascript:...)` 的消息 → 应**转义为纯文本、无脚本执行、无 javascript: href**（react-markdown 默认安全，机测已有回归网，此处肉眼复核真机一致）。
- [ ] **60. 图片附件全链路**：composer 选一张图 → 发送前应见**缩略图预览**（可移除）；≤1MB 原样、>1MB 应降到 2048px JPEG、>20MB 应**内联拒绝**；发送 → 识图槽（gemini）应回答与图相关内容 → 落定后 user 行显示图片缩略图（`<img src>` 应是 `data:image/...`，走 media.get）；滚走再滚回应命中缓存不重复请求。
- [ ] **61. 图片过期降级**：（需等 TTL 或手动清 `attachments/`）过期 ref 的行应显示**"图片已过期"**占位而非崩溃；对应的**识图文本描述**应仍在记忆里（文本权威，D26/决策6）。
- [ ] **62. 无识图槽降级**：`TAKI_VLM_*` 未配置时发图 → 应落库前被拒、聊天窗**内联提示**"需要识图模型"、附件按钮**仍可用**（v1 无配置发现，决策5）、**不落库**。
## 来自 M5 T1（表情动作专项：工具应答纪律 / 词表自愈 / Idle Motion / 鼠标靠近）

> 机器可验部分主脑 + check 双验全绿：全仓 **850** 测试（core 521 含 1c 止损谓词与集成 RED 复证 / desktop 140 含调度器 8 + 靠近 5 + 自愈与换装上报）、`-r typecheck`、`-w lint`、D1 冻结区逐行比对字节不变、e2e 回归网另行由主脑跑。以下是**必须真机看**的活线层：模型行为（灌水）、动画体感（回落/随机闲置/靠近）、governor 真值。启动：`pnpm --filter @taki/desktop tauri dev` + 裸 node 起 core（loopback 免配对已落地）。约 5 分钟。

- [ ] **64. 1c 表达回合无灌水（核心 AC）**：聊几轮带情绪的话让模型调表情/动作 → 回复应**表达与说话同段出现**，最终实质内容之后**不再冒出**灌水段（"嗯。"之类）或接自己话的自言自语。打包轮复验一次更佳（原始证据来自打包轮）。
- [ ] **65. 1b 词表可观测 + 自愈**：开 devtools Console，穿一件**跨引用装扮** → 应见 `[avatar] reported vocab` 日志且数量合理；**每次换装都多一条**（换装必重报的可证明性）。若模型偶用死名字 → 不崩、动作静默不播，且**紧跟一条新的 reported vocab 日志**（漂移自愈触发）。
- [ ] **66. 1a 播完回落（冻帧终结）**：点击 taki 触发反应动作 → 播完后**不冻在最后一帧**，约 1 秒内回到闲置态（呼吸眨眼继续，随后闲置动作接续）。
- [ ] **67. 1a 随机闲置循环**：静置观察 1-2 分钟 → taki 每 **4-12 秒**自播一个闲置动作（`mtn_idle01` 系），间隔有随机感；两动作之间呼吸/眨眼正常不僵。
- [ ] **68. 1a 换装安全**：闲置动作播放**中途**切换装扮 → 无报错，旧调度器停、新装扮的闲置循环接管；模型未加载阶段不崩。
- [ ] **69. D17 靠近反应 + 冷却**：光标滑近 taki（约 140px 内）→ 触发一个反应；**停在近区不连发**；10 秒冷却内离开再进**不**触发，冷却后再进**可**触发；正在播放前台动作时靠近不打断。
- [ ] **70. D17 零干扰**：靠近反应上线后，点击穿透分界、注视跟随、点击分区反应的手感应与之前无差异（复用同一光标轮询，零新 IPC）。
- [ ] **71. governor 静置 CPU 真值**：两次闲置动作**之间**的静置 CPU 应维持 #14 建立的低位（调度器每 0.7s 仅一次 isFinished 轮询）；闲置动作播放的 1-3 秒内允许小幅上升，播完回落。
- [ ] **72. 1e enum 遵守度**：换一件**跨引用装扮**后聊几轮带情绪的话 → 模型调表情/动作应**只用新装扮词表内的名字**（相比 1e 前的死名字应显著减少）；即便偶尔给旧名字，core 日志应见工具调用 `invalid` + 模型收到 tool-error 后自我纠正，**不卡死回合**。遵守度仍不理想就告诉我，补 b（换装后一句隐式提示词提醒）。
- [ ] **73. 1f 换装提醒生效**：换一件跨引用装扮 → 换装后第一次带情绪对话，agent 应更顺畅改用新装扮标签（相比只有 enum 时更少"第一次失败"）；devtools 可见换装后那一轮 outgoing 带 `[System · no reply needed] Costume changed` 前缀，且**不落库**（时间线原始 user 消息无此前缀）。换来换去最后换回原装扮再发消息 → **不应**注入提醒。
- [ ] **74. 超时标识不漂移（Fix1）**：触发一次会超时的换装（roaming C3 wedge）→ 30s 超时后屏幕仍是换前那套，**不会悄悄变成超时那套**；面板高亮、core 词表、重启后 last-costume 均停在换前那套；晚到加载完成也不 attach（abortSwitch 撞 seq 自弃）。
- [ ] **75. 面板超时不卡死（Fix2）**：点一件会超时的服装 → 只有那一行 spinner/禁用，其余行仍可点；有 Cancel 可提前取消；取消/超时后面板立即恢复，无需关闭重开。副作用（D39）：超时/取消后当前模型暂失随机 idle motion（呼吸眨眼保留），下次换装恢复——已登记延后，非缺陷。

发现任何问题在对应条目下写一行，我会开返工轮。



