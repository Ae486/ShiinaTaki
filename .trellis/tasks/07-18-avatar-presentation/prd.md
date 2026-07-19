# T1 — Avatar Presentation (表情动作专项)

M5 task 1 of 11 (blueprint: `docs/devlog/m5.md`). No single GitHub issue — packaged-testing increments (2026-07-18 owner report) + D17's M5 half. Four items, ordered; each lands independently.

## Scope

### 1. Tool-reply discipline (1c — research-first, the bug that degrades every conversation)

Evidence (owner screenshot 2026-07-18): one user message produced 5 assistant segments interleaved with avatar tool calls, ending in filler ("嗯。") and self-conversation drift ("嗯，拜拜。回来再聊" — nobody said goodbye). Mechanism (verified): every avatar tool call ends a ToolLoopAgent step; the `{ok:true}` result forces the model to generate ANOTHER step; having nothing substantive left, it pads — and continues from its OWN last utterance.

Fix directions (research ranks them):
- Prompt layer: avatar vocabulary section gains hard rules — express ALONGSIDE the reply (same step); after a tool result, either substantive content or STOP; never respond to your own message.
- Structural layer (must respect the D1 freeze — `stopWhen`/agent-construction options are allowed, frozen loop bodies are not): step-cap/stop-condition tuning, per-turn avatar-call budget, tool-result shape.
- Sediment the taxonomy (fire-and-forget presentation tools vs read-the-result info tools) into `.trellis/spec/` tool-design guidance.

### 2. Live vocabulary reporting fix (1b)

`avatar-vocabulary.ts` seam already supports live re-reporting (`set` from avatar.report; header says "re-reports on load / costume-swap"), but runtime evidence shows the LLM holds template names that don't exist on the worn costume (cross-character-ref costumes; unknown names are silently ignored). Research locates: WHAT the Pet UI reports (raw settings list vs post-prune resolved list — #18's `settings-prune`/`costumeResolution` data exists) and WHETHER a costume switch re-reports. Fix: report the PRUNED, actually-playable inventory + force re-report on every switch.

### 3. Idle Motion scheduler (1a — renderer reflex, zero-LLM)

Per CONTEXT.md **Idle Motion**: after any one-shot motion finishes → automatic return to the idle state (today: freeze on last frame); while idle → random motions drawn from a preset pool at random intervals. Deterministic, works offline. First Hook consumer (motion-finish → idle return) — but NO generic hook bus yet (YAGNI; extraction when a second consumer appears — write internals extraction-friendly). Pool source v1: derived from the worn costume's resolvable motions (operator-configurable pool arrives with settings #24/#26 — defer the UI, not the mechanism). Must be costume-switch-safe (ticket/isStale pattern) and model-absence-safe.

### 4. Mouse-proximity reactions (D17's M5 half)

Cursor approaching the pet triggers a reaction (BANDORI increment); throttled/cooldown so it never spams. Agent-chosen expressions are Heartbeat territory (T4) — NOT this task.

## Q1 cleanup contract (blueprint)

Research brief includes module-health notes for touched modules (avatar/, renderer live2d/, chat-agent instruction path). Impl fixes debt ONLY in files the task touches (duplication, orphans, stale headers, size caps); untouched files are off-limits. Check verifies both.

## Constraints

- CONTEXT.md terms exactly (Idle Motion / Hook / Heartbeat). Idle animation (engine breathing/blink) is distinct from Idle Motion.
- D1-frozen turn runtime: no frozen-body edits; construction-level knobs (`stopWhen`, instructions, tool sets) are the allowed surface. v7 abort double-ending law applies to any test touching cancellation.
- Renderer stays framework-free (zero React imports); packaged-build defect classes spec applies (`.trellis/spec/frontend/packaged-build.md`); per-window ACL law for any new Tauri API call.
- Protocol: if avatar.report's shape needs a field, additive zod evolution in `@taki/shared` (check protocol.rs mirror status).
- Motion playback keeps `{loop:false}` discipline for one-shots (C3 Meta.Loop gotcha).

## Acceptance

1. (1c) A normal expressive turn produces NO filler segments after the final substantive content (manual packaged round); tool-design taxonomy sedimented in spec.
2. (1b) Wearing a cross-ref costume, the injected vocabulary equals the playable set (no dead names); a costume switch provably re-reports (log/WS trace).
3. (1a) A click reaction ends in a return to idle (no last-frame freeze); idle-pool motions fire at random intervals; costume switch mid-motion and model-less stage are safe.
4. (D17) Proximity triggers a reaction with cooldown; click-through/gaze unaffected.
5. Gates: `pnpm -r test`, desktop+core tsc, lint, packaged smoke; existing avatar/e2e tests stay green.

## 追加轮 (2026-07-19 owner alignment — 换装标签可靠性)

实测:换装后 agent 大多数情况注意不到标签变化(除非用户点破)。功能无误但可靠性低(软约束——词表只在提示词里"建议",对话历史里旧装扮的成功工具调用把模型注意力拉走)。裁定:**先做 a(tool 侧 enum 硬约束),不足再补 b(换装后一句隐式提示词提醒,极低成本)**。

### 1e — 动态 enum 硬约束(本轮做)

把 `avatar_set_expression` / `avatar_play_motion` 的 `name` 从 `z.string().min(1)` 换成**每回合按当前词表动态生成的 `z.enum([...names])`**,空/未加载词表回退 `z.string().min(1)`。工具已逐回合构造(`main.ts:303` `characterTools`),词表可从 `avatarVocabulary` 取——需给 vocabulary 加 `get(characterId)`。与刚落地的 1b `onVocabularyDrift` 自愈成**双保险**:enum 源头挡(模型只见新装扮合法值)、drift 自愈兜底(漏网即时重报纠偏)。

**必须先查证再实现(外部 API 行为,禁凭记忆)**:① zod 4 `z.enum()` 对动态 `string[]` 的正确构造(查装机类型 `node_modules/.pnpm/zod@4.4.3/...`,TS 元组类型陷阱);② AI SDK 7 把 zod enum 转 JSON Schema 的行为 + **模型返回非 enum 值时 SDK 的处理**(优雅降级?抛错?——若 enum 会导致工具调用硬失败,风险高于收益,停下报告,退回 string+drift 自愈+需求 b);③ **真模型 smoke**(唯一遵守度铁证):.env.local 真 provider,换装后验证模型只用新 enum 值(非默认 TAKI_WS_PORT + 事后杀进程树)。若 provider 不强制 enum,enum 仍作"结构化合法清单"保留(净提升),如实报告。

**Option A 澄清**:#16"no baked enum"= 拒**编译期**烤死枚举(多角色多装扮);动态运行期从 manifest 派生的 enum 不违反其精神——注入点从提示词挪到 schema,数据源仍是实时词表。此区别写入 spec。

### 需求 2 — 闲置池可配置化:延后

用户裁定暂不做,登记为 **D38**(`docs/deferred-decisions.md`),触发 M5 #24/#26 设置面板。机制已注入式预留,本轮不动。

### 1f — 换装提醒注入 + 超时标识修复(2026-07-19,一个批次;顺序 Fix1 → Fix2 → 1f)

实测 enum(1e)不足以让 agent 换装后可靠改用新标签,补 b:换装后一次性向模型注入提醒。诊断(`research/re-costume-timeout-diagnosis.md`,主脑已核验)揭示一个前置缺陷必须先修。判定依据 = **costume id**(唯一,如 arbeit/arbeit_ring_01),比标签集合准。

#### Fix 1 — 超时晚到模型污染屏幕(1f 硬前置)
诊断 Q3:`withTimeout`(promise-timeout.ts)不取消源;换装超时后若模型"慢但最终加载完"(非永不完成)且期间未再点,`reloadModel`(costume-switch.ts:47)的 isStale=false → :53 attach 晚到模型 → 屏幕变超时那套,而 core 词表停在 pre-switch → **屏幕与能力不一致**(模型拿旧词表 emote 穿新装的角色)。
- 加 `PetScene.abortSwitch()`:撞 `ctx.seq.current`(复用现有 switch ticket,pet-scene.ts:66/116),使任何在途 `reloadModel` 的 `isStale()` 转 true → 晚到模型自弃(removeChild+destroy+throw),不 attach、不 reportAvatar。
- 调用点:`use-costume-switch.ts:94` catch(超时/失败)调 `scene.abortSwitch()`;`resolve-switch-report` 失败路径同理。
- 保证:屏幕 + 三处存储(前端 current / core 词表 / last-costume)超时后永远一致停在 pre-switch,无论"慢"或"永不完成"。幂等 + model-less 安全。
- 测试 `pet-scene.test.ts`:可控 load,超时→abortSwitch→晚到 resolve ⇒ slot 不变、晚到模型 destroyed、无 reportAvatar 调用。

#### Fix 2 — 面板超时卡死(纯 UX,复用 abortSwitch)
诊断 Q1:`isSwitching` 整个 30s 为 true → `character-panel.tsx:82 disabled={isSwitching}` 禁用所有行 30s;关闭重开是 unmount 重置(非并行信号)。
- 只禁**在途那一行**(+ spinner),不禁整列;加 Cancel 入口,点击调 `scene.abortSwitch()` 并提前结束 isSwitching。
- `switchTo` 加重入守卫 `if (isSwitching) return;`(现 deps 未含 isSwitching,用 ref 避免闭包过期)。
- 无 React hook 测试基础设施 → UX 主要人工验收;可测的纯逻辑尽量测。

#### 1f — 换装判定 + 提醒注入(建于修好的成功信号)
- **协议(additive,无 Rust 镜像)**:`AvatarReportParamsSchema`(avatar-schema.ts:26)加 `costume: z.string().optional()`。该 schema 自述 operator-only NO Rust mirror,protocol.rs 零匹配——不碰 Rust。往返测试 `avatar-schema.test.ts`。
- **前端上报 costume id**:`resolve-switch-report.ts:33` reportAvatar 传 `costume: deps.costume`(已有);promotion(`use-initial-costume`)传 last-worn id;boot(`use-core-connection`)拿不到正式 costume 时留 undefined(core 以此建初始基线,不误判)。
- **core 判定(基线快照,非相邻 diff)**:vocabulary store 存 current costume id + `lastSeenCostume[characterId]`(模型上次回合看到的 id)。
  - `set()`:更新 current(词表 + costume id),**不推进 lastSeen**。首次 set:lastSeen=current(初始基线,首回合不注入)。
  - 回合组装消费 `consumeCostumeChanged(characterId)`:current costume ≠ lastSeen → true 且推进 lastSeen=current;相等 → false。
  - 换来换去验证:A(lastSeen=A)→B→C→A(均未发消息,lastSeen 停 A)→发消息:current=A==lastSeen → **不注入** ✓。undefined==undefined(dev/boot)→ 不注入。
- **注入(#17 additive message seam,非 D1 冻结)**:`chat-agent.ts:104` outgoing 构造,若 `consumeCostumeChanged` → 在**发给模型的**最后一条 user 消息前缀提醒;`history` 原始消息不变(不落库、one-shot)。加 chat-agent dep(如 `costumeNotice?: (characterId) => string | undefined`),main.ts 注入(消费 vocabulary 的 consumeCostumeChanged)。**D1 红线**:只碰 line 104 outgoing 构造 + deps 接口;for-await 循环/persistTurn/retract/abort/toolApproval 字节不变。
- **提醒措辞(英文简洁)**:`[System · no reply needed] Costume changed; your available avatar tags were updated to your current vocabulary. Ignore tag names from earlier turns.`
- **常驻说明**:`assistant-layer.md` §"Showing what you feel"(line 30 后)加一句:换装机制 + 收到系统换装提示时切新标签、视为例行、无需回应。
- 窄边缘:换装后首条消息若 cancel-retract,lastSeen 已推进 → 下次可能漏一次提醒,enum 兜底,接受(代码注释标注)。
- 测试:vocabulary 换装判定单测(基线快照 + 换来换去不注入 + undefined);chat-agent outgoing 前缀 + 消费即清 + 不落库确定性单测;协议往返。真模型遵守度 + 屏幕/词表一致性 → 人工验收 72 + 新增超时项。
