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
