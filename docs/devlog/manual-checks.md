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
