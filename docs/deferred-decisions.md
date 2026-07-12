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
| D1 | **回合生命周期缺陷集**：timeline 丢失 tool-call/result、无基础 system prompt、回合无并发串行化、无取消/中断、中断回合丢失已流文本 | M1 时无工具(text-only 合理起点);其余是 agent runtime 基本功在渐进交付中的欠账 | **立即** —— 幻觉已在生产暴露,阻塞 M4 的 #16/#17(聊天窗要渲染工具记录) | 任务 `agent-harness-improve`(原 `agent-tool-timeline` 升级) | SCHEDULED |
| D2 | **shell-open 的 Always 持久化 → 静默任意执行**(A1) | name-keyed 持久化对"启动"类能力是错的(target 才界定动作) | **M4 前** | 任务 `shell-open-persist-fix`(DONE);原则沉淀于 `.trellis/spec/backend/permission-authorization.md` | DONE |
| D3 | **exec argv[0] 未按排除 cwd 的 PATH 解析为绝对路径**(B2) | 当前被"write_file 只写文本 + allowlist 默认空"缓解 | **exec auto-run 配置上线前必修** | GitHub #23 | OPEN |
| D4 | **上下文压缩 / token 预算** | ADR 0005 明列为 "later concern";`REPLAY_WINDOW=200` 硬截断 | 长对话撞上下文窗口 / M5 | ADR 0005 | OPEN |
| D5 | **调度器(croner)/ 主动性** | 无 `scheduler/` 目录;主动性属 M5 | M5 立项 | GitHub M5 (#19–#26) | OPEN |
| D6 | **文件 R/W 从 Core-side 迁移到 Node-routed** | ADR 0007 Stance A:v1 单机 Core-side,双机拆分留 v1.5 | 双机部署 / v1.5 | ADR 0007 | OPEN |
| D7 | **弹窗文字渲染 / 浏览器真开 / keyring 条目** 三项手测 | 视觉验收与真实副作用无法无头化 | 保持人工(每次能力改动后抽验) | 任务 `e2e-manual-checks-port` PRD | OPEN(人工) |
| D8 | **CLAUDE.md 工具链 Rust `>=1.88` → `>=1.95`** | sysinfo 0.39 patch 级 MSRV 抬升;`Cargo.toml` 已改,CLAUDE.md 待同步 | 下次触碰 CLAUDE.md 工具链表 | `blocked.md` BLOCK-1 | OPEN |
| D9 | **emotion capsule / companion state 模块**(黄金样本级) | 喂 persona 的情绪胶囊现为静态 `"Current mood: neutral."` 占位(`assembler.ts:15`);mood-gated 记忆层已落地,但情绪信号恒定中性 → PRODUCT.md:10 承诺的"看情绪出话"半接线、真实场景空心。v1 先出确定性输出;companion state 模块未建(仅 MEMORY-DESIGN.md:66 提及一次) | **"角色真实感"优化任务(待立项)**;M4 #16(情绪驱动表情)会先碰到 | `assembler.ts:13`、已归档 `07-10-memory-engine/prd.md` | OPEN |
| D10 | **core 关停链缺 `.catch`** | `server.close()` 拒绝时 SQLite 句柄不释放(自述极低概率);M1 记为"待后续顺手修",只写在 devlog | 下次触碰 server 关停链 | `docs/devlog/m1.md:13` | OPEN(低危加固) |
| D11 | **硬编码默认值待 config 化** | exec 输出上限/超时(`policy.rs:14`)、episodic 汇总节奏 `EPISODIC_EVERY_N=20`(`auto-memory.ts:12`)等;v1 硬编码求确定性,HANDOFF:118 认可的占位默认值 | M5 settings 面板统一暴露 | HANDOFF:118 | OPEN(良性可调) |
| D12 | **shell-open 域名级 url 白名单** | 三类隔离(url-safe/local-file/local-exec)已堵 A1;域名粒度(`domain:*.github.com`,à la Claude Code)是更细的可配控制 | 需要比"所有 url-safe scheme 静默"更细时 | 任务 `shell-open-persist-fix` PRD | OPEN |
| D13 | **shell-open 危险目标的 smart-LLM 审阅层** | 未命中的 local-exec 先让辅助 LLM 分类再决定升级(Codex Smart Approvals / Hermes smart);A1 靠类隔离已治本,这是 make-it-fast 增强 | make-it-fast 阶段 / 主动性里程碑 | 任务 `shell-open-persist-fix` PRD | OPEN |
| — | **Deferred issues #27–#34** | v1.5/v2 追踪器,故意不实现 | 永不作为 `ready-for-agent` | GitHub #27–#34 / HANDOFF | OPEN(设计延期) |

> 补齐一项后:状态改 `DONE`、注明补齐的 commit/任务、保留行(留档,不删)。

> **D9 补齐约束(用户裁定 2026-07-12)**：涉及"角色灵魂 / 角色记忆"的模块必须保持 data-driven、可扩展,后期填充而非推倒重来。现状核实:
> - **记忆侧已达标** —— `layer-registry.ts` 声明式,加层 = 加一行,引擎不变。
> - **灵魂侧** —— `persona` / `emotion` 是 `assembler.ts` 里的内联静态占位;组装用 sections 数组(可扩展)。补齐时走**注入路径**:给 assembler 注入 `persona` / `emotion` provider(当前静态实现→真实源),**勿改组装框架、勿写死角色数据源**。
> - 现在**不预留 provider 接口**(YAGNI —— 只塞静态值的抽象是投机);接真实源时(#16 / 角色真实感任务)自然引入,届时有真实实现锚定接口形状。约束记在此处,立项时照做。

> **D1 验收要求(2026-07-12)**：任务 `agent-harness-improve` 必须先建一个**多回合幻觉复现 L2** 作为 before-baseline。当前 4 个 L2(exec/clipboard/workspace/screenshot)是全新空库 + 单回合 + 强指令,**即使不修也是绿的、测不到幻觉**。真复现需:多回合积累(先让 agent 成功调用几次)或预置被"口头成功"污染的 timeline,再看 agent 是否退化成幻觉。**修复前该测应红,修复后转绿 —— 这才是幻觉真被治好的铁证**;没有它,任务 3 的"修好了"无从证明。
