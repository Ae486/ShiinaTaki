# 延期决定登记册 (Deferred Decisions)

> **目的**：任何"这一版先不做、留到后续补"的决定,必须在**立项时**登记于此。
>
> 延期本身不是问题,**追踪失败**才是。一个埋在代码注释或口头里的延期决定,会在下一个里程碑被漏掉——于是"计划中的延后"悄悄变成"永久缺陷"。这里是唯一的集中登记锚点:醒目、集中、每项带**补齐触发条件**。
>
> **规则(强制)**：
> 1. 立项(brainstorm / PRD)时,凡是决定延后的功能、保真度、加固项 → 立刻在下方登记表加一条。
> 2. 每条含:**延期了什么 / 为什么 / 触发补齐的条件或里程碑 / 追踪锚点(issue·任务·ADR)/ 状态**。
> 3. 状态:`OPEN`(待补,未排期)· `SCHEDULED`(已排入某任务)· `DONE`(已补,留档)。
> 4. 代码里若有 "TODO: later" 级的延期,注释旁**必须引用本文件的条目编号**,不得只留裸注释——裸注释就是追踪失败的起点。

---

## 教训案例 — timeline 工具保真(差点变永久缺陷)

M1 设计对话存储时还没有工具,`conversation-store.ts` 做成 text-only 是合理起点,并留了一行注释 *"multi-part fidelity returns when tools land"*。但这个延期决定**只活在代码注释里**,没升级成 ADR、没进 M3 验收清单。M3 加工具时,Shell handler / Core tool / gate / audit 全补齐了,**唯独 timeline 被漏**——因为触发它的 TODO 埋在注释里,不是一个会拦住 M3 的显式 blocker。

结果:agent 跨回合看不到自己调过工具 → 幻觉"已调用工具"实则未调。这个缺陷**只在真实多回合场景暴露**(单回合单元测试全绿),直到用户手测才发现,险些成为永久缺陷。

**这就是本登记册存在的理由。** 修复由任务 `agent-harness-improve`(下方 D1)承担。

---

## 登记表

| # | 延期项 | 为什么延 | 触发补齐 | 锚点 | 状态 |
|---|---|---|---|---|---|
| D1 | **回合生命周期缺陷集**：timeline 丢失 tool-call/result、无基础 system prompt、回合无并发串行化、无取消/中断、中断回合丢失已流文本 | M1 时无工具(text-only 合理起点);其余是 agent runtime 基本功在渐进交付中的欠账 | **立即** —— 幻觉已在生产暴露,阻塞 M4 的 #16/#17(聊天窗要渲染工具记录) | 任务 `agent-harness-improve`(原 `agent-tool-timeline` 升级) | DONE(2026-07-13 补齐:parts 列 + appendTurn 全回合持久化、BASE_SYSTEM_PROMPT、turn-queue 串行化、chat.cancel + abort、部分文本落盘;幻觉复现 L2 红→绿) |
| D2 | **shell-open 的 Always 持久化 → 静默任意执行**(A1) | name-keyed 持久化对"启动"类能力是错的(target 才界定动作) | **M4 前** | 任务 `shell-open-persist-fix`(DONE);原则沉淀于 `.trellis/spec/backend/permission-authorization.md` | DONE |
| D3 | **exec argv[0] 未按排除 cwd 的 PATH 解析为绝对路径**(B2) | 当前被"write_file 只写文本 + allowlist 默认空"缓解 | **exec auto-run 配置上线前必修** | GitHub #23 | OPEN |
| D4 | **上下文压缩 / token 预算** | ADR 0005 明列为 "later concern";`REPLAY_WINDOW=200` 硬截断 | 长对话撞上下文窗口 / M5 | ADR 0005 | OPEN |
| D5 | **调度器(croner)/ 主动性** | 无 `scheduler/` 目录;主动性属 M5 | M5 立项 | GitHub M5 (#19–#26) | OPEN |
| D6 | **文件 R/W 从 Core-side 迁移到 Node-routed** | ADR 0007 Stance A:v1 单机 Core-side,双机拆分留 v1.5 | 双机部署 / v1.5 | ADR 0007 | OPEN |
| D7 | **弹窗文字渲染 / 浏览器真开 / keyring 条目** 三项手测 | 视觉验收与真实副作用无法无头化 | 保持人工(每次能力改动后抽验) | 任务 `e2e-manual-checks-port` PRD | OPEN(人工) |
| D8 | **CLAUDE.md 工具链 Rust `>=1.88` → `>=1.95`** | sysinfo 0.39 patch 级 MSRV 抬升;`Cargo.toml` 已改,CLAUDE.md 待同步 | 下次触碰 CLAUDE.md 工具链表 | `blocked.md` BLOCK-1 | OPEN |
| D9 | **emotion capsule / companion state 模块**(黄金样本级) | 喂 persona 的情绪胶囊现为静态 `"Current mood: neutral."` 占位(`assembler.ts:15`);mood-gated 记忆层已落地,但情绪信号恒定中性 → PRODUCT.md:10 承诺的"看情绪出话"半接线、真实场景空心。v1 先出确定性输出;companion state 模块未建(仅 MEMORY-DESIGN.md:66 提及一次) | **"角色真实感"优化任务(待立项)**;M4 #16(情绪驱动表情)会先碰到 | `assembler.ts:13`、已归档 `07-10-memory-engine/prd.md` | OPEN |
| D10 | **core 关停链缺 `.catch`** | `server.close()` 拒绝时 SQLite 句柄不释放(自述极低概率);M1 记为"待后续顺手修",只写在 devlog | 下次触碰 server 关停链 | `docs/devlog/m1.md:13` | OPEN(低危加固) |
| D11 | **硬编码默认值待 config 化** | exec 输出上限/超时(`policy.rs:14`)、episodic 汇总节奏 `EPISODIC_EVERY_N=20`(`auto-memory.ts:12`)等;v1 硬编码求确定性,HANDOFF:118 认可的占位默认值 | M5 settings 面板统一暴露;**agent turn step cap 已先行 config 化(2026-07-13:`TAKI_MAX_STEPS`,默认 10,`config/agent-config.ts`)** | HANDOFF:118 | OPEN(良性可调,部分补齐) |
| D12 | **shell-open 域名级 url 白名单** | 三类隔离(url-safe/local-file/local-exec)已堵 A1;域名粒度(`domain:*.github.com`,à la Claude Code)是更细的可配控制 | 需要比"所有 url-safe scheme 静默"更细时 | 任务 `shell-open-persist-fix` PRD | OPEN |
| D13 | **shell-open 危险目标的 smart-LLM 审阅层** | 未命中的 local-exec 先让辅助 LLM 分类再决定升级(Codex Smart Approvals / Hermes smart);A1 靠类隔离已治本,这是 make-it-fast 增强 | make-it-fast 阶段 / 主动性里程碑 | 任务 `shell-open-persist-fix` PRD | OPEN |
| D14 | **timeline parts 丢弃 reasoning / file / approval part** | `turn-mapping.ts` 持久化回合时只保留 text / tool-call / tool-result;reasoning、file、approval-request/response part 被丢弃(当前无重放价值,provider 也不要求)| M4 聊天窗需要渲染思维链/文件卡,或 provider 要求重放 reasoning 时 | `turn-mapping.ts:assistantEntry`、任务 `agent-harness-improve` | OPEN |
| D15 | **排队中断连的回合仍完整执行** | `chat.send` 排在 turn-queue 里等锁的回合,若期间连接关闭,拿到锁后仍对已关闭 socket 完整跑一轮(真实 provider 浪费 token);进行中回合的取消已覆盖,仅"排队中"这一窄口未覆盖,数据无损坏 | 多回合高并发/主动性上线,或 token 浪费显著时 | `turn-queue.ts`、`chat-send.ts`、任务 `agent-harness-improve` | OPEN(窄边缘) |
| D16 | **抛错多步回合丢失已完成步的工具记录** | error 路径(`streamEnded=false`)不 await `responseMessages`(ai@7.0.17 流被弃置后 promise 可能永不 settle,await 会挂起),故多 step 回合若后续 step 抛错,仅 partial 文本落盘、已完成 step 的 tool 记录丢失 | 若发现 error 后跨回合幻觉复发,或有低成本的带超时 race-await 方案时 | `chat-agent.ts:persistTurn`、任务 `agent-harness-improve` | OPEN(极窄边缘) |
| D17 | **BANDORI 增量采纳的后置部分**(2026-07-13 功能对比评审,用户全采纳):鼠标靠近反应 + 桌面情境待机(M5)、点击性格预设的设置面板入口(M5)、口型完整落地(振幅走渲染器内建轮子 + viseme 规则表移植)+ 情绪→TTS 语速联动(v2,随 TTS) | 宿主里程碑未到;M4 内可落的增量已直接写入 #13/#14/#16 正文 | 各宿主 issue 开发时(增量段已写入 issue 正文,带 [v1/M5]/[v2] 标注) | issues #21/#24/#31 增量段;模式出处 `live2d-presentation-analysis.md` | SCHEDULED |
| D18 | **专有运行时的生产打包隔离**:vendored Cubism 运行时(`live2dcubismcore.min.js`/`live2d.min.js`)位于 Vite `publicDir`,`vite build` 会复制进 `dist/` → 随 Tauri app 打包分发;但它们专有、**永不 bundle**(TECH-STACK:用户侧下载脚本安装后获取)。另 `spike.html` 仍是生产 Rollup 入口(纯 spike 脚手架,不该进生产 build) | 开发环境下 publicDir 加载完全正常(#13 spike + #14 pet 窗均 working),不阻塞任何功能 AC;git 全程干净(专有文件 ignored,CI 无泄漏)。**触发修正**:这是发布工程问题(生产运行时加载策略 + dev-gate spike),非 #14 功能验收——原登记触发"#14 落地渲染器时"不精确,#14 只落地功能 | **生产打包/分发工程立项时**(v1 ship shape 前):(A) dev-gate `spike.html` 移出生产 Rollup 入口;(B) 专有运行时改由安装后下载脚本落到 app 可读路径、不进 bundle | issue #13/#14 增量段;`spike-check` + `overlay-check` 审计;vendor 脚本 POS 头 | OPEN(发布工程,已澄清触发) |
| D19 | **渲染节流开关的配置持久化**:#14 让渲染器读一个本地 `renderThrottling` 标志(默认 true),真正接入用户配置系统(走 Agent Core 配置路径,属角色资产)留到 M5 设置面板 | #14 只需渲染器尊重该标志;配置系统的接线是 M5 Presentation 组的活,提前接会引入未定的配置协议 | **M5 #24**(设置面板 Presentation 组:render throttling 开关) | issue #14 prd;PRODUCT.md Presentation 组 | SCHEDULED |
| D20 | **启动时 main + pet 双窗口的产品取向**:#14 起 pet 悬浮窗与 M3 遗留的 main 窗口(配对/状态面板)都在启动时打开;main 是否该合并进/隐藏到 pet 之后(如首次配对用 pet 上的临时 UI、之后 main 不再默认弹) | #14 只负责加 pet 窗;改动 main 的启动行为是产品决策,且配对流程会在 M5 设置窗口 #22 重新编排 | **M5 #22**(设置窗口 shell 落地,配对入口重排时)或用户提前裁定 | issue #14 research/02;`overlay-impl` 交付备注 | OPEN(产品取向) |
| D21 | **TTS 呈现设计裁定集**(2026-07-14 讨论,记录待 #31 实现):显示时机以"TTS-ready"为唯一触发(整条回复粒度,拒绝逐句分段)、TTS 是管线环节非 LLM 工具(开关/字数阈值/文本净化都在合成环节内)、情感复用 avatar emotion 信号不新增 TTS 工具、单内容双通道同步、标志音库(预录+TTS 混合,句级不拼接)、引擎待 #31 按当时方案选(user 现有 so-vits-svc/RVC 是 SVC 非 TTS) | TTS 属 v2/#31,现在一行不写;记录只为让 #16 预留兼容接缝(呈现层 keyed on "ready" 信号、emotion 信号单源双消费),避免后期大改 | **#31**(TTS activation + lip-sync)立项时:按 BANDORI `tts_manager.py` 实测方案 + 联网选引擎落地 | `docs/TTS-INTERFACE.md`(呈现时机+开放问题段);讨论 2026-07-14 | SCHEDULED |
| D22 | **人设卡 + 助手人格层的用户可编辑 + 灵魂互换选择器**(2026-07-14 用户指令):persona card(角色设定,忠于原著,**per-character**)与 assistant layer(助手能力人格,防过度角色扮演忽略本职,**全局共享/所有角色通用**)是两张独立数据卡,装配式注入(assistant layer 在前定能力基调、persona 在后定角色);统一存于根目录 `prompt/`(`system/assistant-layer.md` + `characters/<id>/persona.md`),作为分发默认。都可编辑,persona 示例用中文。设置面板加"人设选择器"(从 `prompt/characters/` 下拉,任意 persona 配任意模型,自由灵魂互换)+ assistant layer 编辑。PRODUCT 原"默认只读预览"→ 可编辑 | #16 先做 `prompt/` 文件化 + 注入路径(assembler 读文件、不写死);编辑器 + 选择器 UI 属 M5 设置面板 | **M5 #24**(设置面板 Character 组:persona 选择器 + 全局 assistant-layer 编辑器) | `prompt/README.md`;PRODUCT.md Character 组;`assembler.ts` 注入点;#16 prd | SCHEDULED |
| D23 | **远程连接认证取向 = 填接口 + token/Tailscale,不做交互式配对码 UI**(2026-07-14 用户裁定):本机 Pet UI↔Core 走 localhost 免配对自动信任(#16 P3);VPS 远程(手机/本机↔公网 Core)靠用户填入的接口 + 凭据(Tailscale 优先,零 TLS;公网 WSS + 设备 token 兜底)—— 填接口本身即认证。ADR 0004 的交互式配对码握手是"陌生设备首次配对"的最重形态,实际部署用不到,很可能不做或仅 v2 手机节点按需出最简版 | 本机场景加配对码 UI 荒谬;VPS 场景认证已由"接口+token"承担 | **v1.5 VPS 部署(#29)** 设计远程连接时按此取向;v2 手机节点(#32)若需再评估 | ADR 0004;TECH-STACK 跨设备段;#16 prd(P3 本机免配对) | SCHEDULED |
| D24 | **一体化启动(发布工程)**:正式发布时双击图标 → Rust Shell 自动拉起 Core 子进程 → Pet UI 自动连本机 Core,零手动步骤(用户不该手动启动 core/cli/本体、不该手动配对)。#16 开发期仍分别启动 Core + Pet UI(开发便利),但连接用"本机免配对直连"这一最终正确方式,故打包时只需解决"自动启动进程",连接逻辑不改。CLI 是开发期调试入口,正式产品用户不可见 | 开发期分启方便;进程编排是打包关注点,非功能 issue | **生产打包/分发工程立项时**(v1 ship 前,与 D18 同批) | #16 prd;D18(同属发布工程 track) | OPEN(发布工程) |
| D25 | **loopback auto-trust 的多用户/共享主机边界**(fable5 安全 check R2/R1/R4 记录,2026-07-14):P3 在共享/多用户 Windows(或终端服务器)上,同机其他用户的进程也能连 127.0.0.1 并作为 operator 自动信任(拿到完整 agent 访问);单用户桌面(v1 目标)无虞。另 R1:`trustDevice` upsert 可被本机进程用已存在 deviceId 覆盖(本机 DoS/滋扰,非提权,角色仍锁);R4:devices.json 无逐出、每个 auto-trust deviceId 增一条 | 单用户桌面是 v1 目标,均在既定"机器信任边界"内(同用户进程本可直接改 devices.json);`trustLoopbackOperator` 开关即缓解手段 | **写入 v1 运维/安全文档**(ship 前);若上多用户支持则 `trustDevice` 拒绝角色冲突覆盖 + 记一行安全说明 | `connect.ts` P3 分支;fable5 安全 check 报告 R1/R2/R4 | OPEN(运维文档,边界内) |
| D26 | **跨回合图片记忆**(#17,2026-07-14 用户裁定 1a 升级):原案(v1 图片字节仅当前回合在途、历史投影为 `[image]` 占位)→ 跨回合模型看不到旧图。**已由"识图描述作为记忆"取代**:含图回合后 detached 调 VLM 产出忠实文本描述、写入记忆引擎(episodic),文本为权威、永久;后续回合靠记忆检索"记得"图片内容(纯文本模型亦可)。原图仅临时保留(可配置 TTL + GC),过期删 | 描述记忆 = 直接、省 token、模型无关的正解;重放原图字节昂贵且无必要。→ **功能需求已满足**;真正延期的只剩"跨回合重放原始像素",这是**有意的非目标**(文本权威,非缺口) | 若未来确需"逐像素跨回合视觉"(罕见)再评估;否则永久保持文本权威 | prd §2 决策6/9、§4.2;`image-description-writer.ts`;记忆引擎 | DONE(2026-07-14 方案定为描述记忆;实现随 #17 Phase A) |
| D27 | **缓存管理 UI**(图片/记忆文本容量统计 + TTL 编辑 + 主动清理)(2026-07-14 用户建议):#17 后端已建 `media.usage`(附件字节 + 记忆文本字节)、`media.clear`(主动清)、可配置 TTL + GC;**设置面板 UI**(看容量、调 TTL、一键清理)留到 M5 | 后端能力属 #17(图片生命周期);面板 UI 是 M5 设置组的活,提前接会引入未定的设置协议 | **M5 #24**(设置面板:存储/记忆管理组) | prd §2 决策9;`media-usage.ts`/`media-clear.ts`;PRODUCT 设置组 | SCHEDULED |
| D28 | **记忆系统整体重设计**(用户 2026-07-14:"当前的记忆系统还没达到我想要的效果,待后期 agent 人格真实性优化(或者更之后)再做相关设计")。**即刻生效的工程约束**:在重设计到来前,一切触碰记忆的新代码必须高内聚、低耦合、模块化——单文件模块、走现有 hook/注册/存储写入路径、可删可换,不得加深对现有引擎的耦合、不得让后期重设计变难(首个适用者:#17 的 `image-description-writer`,一个可删的 detached writer) | 记忆是"角色灵魂"核心,值得整体设计而非零碎堆补;当前渐进产物未达期望,零碎修补只会加大重构成本 | **人格真实性优化任务立项时**(与 D9 同批评估);在那之前每个触碰记忆的任务都受此约束 | D9 补齐约束(数据驱动同旨);`layer-registry.ts`(声明式先例);#17 prd §7 D28 条 | OPEN(设计延期 + 现行约束) |
| D29 | **ws-client 中途断连的回合永不 settle**(fable5 #17 Phase B check 发现,#16 起即存在):socket 在回合进行中死亡时,`chat.complete/error` 不再到达,而 `rejectAllPendingRequests` 只覆盖 ack → 调用方 `client.chat()` 挂起,该窗口 isSending 卡住直到重开窗口。修法已明确:transport close 时 settle 活动回合的 handlers | 窄边缘(需 socket 恰在回合中死亡);两消费者(气泡/聊天窗)重开即恢复,无数据损坏;#17 收官不为此重开 check 循环 | 下次触碰 `ws-client.ts`(M5 设置窗接线大概率触发),顺手修 + 断连中回合的单测 | `apps/desktop/src/lib/ws-client.ts`;fable5 #17-B check 报告 §7 | OPEN(窄边缘,修法已知) |
| D30 | **v1.5 分机部署的角色资产 locality**(#18 research arch §7 决策7,2026-07-15):v1 单机下角色模型经 Tauri `asset:` 协议由宿主 WebView 直读 Workspace `characters/`;分机部署时 Workspace 在 VPS Core 上、而 serving 协议在宿主侧 → `asset:` 读不到。v1 单机下不触发 | 单机是 v1 目标,`asset:` 直读最简;分机是 v1.5 工程,提前设计引入未定的跨机资产传输协议 | **v1.5 分机构建**(#29);届时用 ADR 0007 的 file-RW 宿主迁移(extraction 移到宿主侧)或切到 WS-base64(arch §6 Option C) | 任务 `07-15-character-import` prd §2 决策7;research `ra-asset-architecture.md` §7;ADR 0007 | OPEN(架构延期,分机触发) |
| D31 | **`.zst` 打包器 / author-side 归档创建**(#18 research zst §6,2026-07-15):#18 只需 `.zst` 的**读取器 + 通用导入**,不需写入器。若未来要"把自制角色重新打包成 `.zst`"的作者工具(逆算法:tar `w|` + zstdCompress,index member 先写),再做 | 角色导入/换装不需要创建 `.zst`;打包器是独立的作者向工具,现无需求 | 需要 author-side 归档创建能力时(逆算法已在 research 备档) | research `rb-zst-and-cubism.md` §6;`TOOL-convert_models_to_zst.py`(参考,GPLv3) | OPEN(无需求延期) |
| D32 | **通用(非图片)文件上传**(2026-07-16 用户"图片/文件上传入口"):聊天窗附件入口当前只收图片(`accept="image/*"`,走 #17 识图管线);通用文件(文本/PDF/任意)无摄取管线——文本模型如何读文件内容、大小上限、存储/TTL 均未设计 | 图片链路已闭环(入口按钮 2026-07-16 修为 SVG 可见);通用文件是独立摄取管线,顺手做会引入未定设计 | 用户提出"发非图片文件给 agent"的需求时立项(届时定:文本内联 vs 附件存储引用 vs 工具按路径读取) | `composer.tsx`(入口);#17 attachments 管线;`ImageAttachment` schema | OPEN(待需求) |
| D33 | **消息级操作(编辑/删除/重新生成)**(2026-07-17 用户"消息编辑加入待办"):聊天时间线每条消息通过右键或 hover 浮现操作按钮(删除、编辑、重新生成);需消息行 hover/间距交互设计 + Core 侧时间线条目可编辑/删除(单写者 inv.2 + D1 frozen turn 需 additive seam)+ 重新生成(以该条为界重跑) | M4 收尾优先;这是独立的时间线可变性能力,非当前 cancel/toast 范畴 | 用户明确要做消息编辑时立项 | 聊天窗 `timeline-message.tsx`;`conversation-store`;D1 frozen turn runtime | OPEN(待需求,UI 未定) |
| D34 | **统一 toast/浮层通知组件**(2026-07-17 用户):现有通知(cancel 提示、chat.error、加载失败、场景/开窗错误)是占布局高度的行内元素,消失时跳变。改为浮在上层的 toast:不占正常布局高度、k 秒后或点击别处自动消失、hover/点击其上时暂停消失(便于看清+复制)。一个可复用组件,桌宠窗错误条 + 聊天窗通知共用 | 正在实现(本轮 #17 收尾 polish);登记以固化设计约束 | 本轮实现 | 聊天窗 `chat-timeline-store` notices / `composer` NoticeBar;桌宠 `pet-stage` 错误条;气泡开窗错误 | IN PROGRESS(2026-07-17) |
| — | **Deferred issues #27–#34** | v1.5/v2 追踪器,故意不实现 | 永不作为 `ready-for-agent` | GitHub #27–#34 / HANDOFF | OPEN(设计延期) |

> 补齐一项后:状态改 `DONE`、注明补齐的 commit/任务、保留行(留档,不删)。

> **D9 补齐约束(用户裁定 2026-07-12)**：涉及"角色灵魂 / 角色记忆"的模块必须保持 data-driven、可扩展,后期填充而非推倒重来。现状核实:
> - **记忆侧已达标** —— `layer-registry.ts` 声明式,加层 = 加一行,引擎不变。
> - **灵魂侧** —— `persona` / `emotion` 是 `assembler.ts` 里的内联静态占位;组装用 sections 数组(可扩展)。补齐时走**注入路径**:给 assembler 注入 `persona` / `emotion` provider(当前静态实现→真实源),**勿改组装框架、勿写死角色数据源**。
> - 现在**不预留 provider 接口**(YAGNI —— 只塞静态值的抽象是投机);接真实源时(#16 / 角色真实感任务)自然引入,届时有真实实现锚定接口形状。约束记在此处,立项时照做。

> **D1 验收要求(2026-07-12)**：任务 `agent-harness-improve` 必须先建一个**多回合幻觉复现 L2** 作为 before-baseline。当前 4 个 L2(exec/clipboard/workspace/screenshot)是全新空库 + 单回合 + 强指令,**即使不修也是绿的、测不到幻觉**。真复现需:多回合积累(先让 agent 成功调用几次)或预置被"口头成功"污染的 timeline,再看 agent 是否退化成幻觉。**修复前该测应红,修复后转绿 —— 这才是幻觉真被治好的铁证**;没有它,任务 3 的"修好了"无从证明。
