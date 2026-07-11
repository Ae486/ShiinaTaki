# 阻塞事项（需要你介入）

> STOP-ON-BLOCKED 协议输出。主脑遇到无法自行解决、需要你的环境/决策的问题时写在这里,停止受影响的开发线,继续推进不受影响的部分。你醒来第一眼看这里。

---

## BLOCK-1 — crates.io 在此机不可达,#11 及后续所有 Rust/Shell 工作的 cargo 验证被卡（2026-07-11）——已解除

**解除（2026-07-11）**：用户修复网络后 crates.io 可达;`cargo` 拉取时暴露 `sysinfo 0.39.6` 需 rustc 1.95（patch 级 MSRV 抬升,本机为 1.88）。主脑裁定**升级 rustc 而非降级 sysinfo**（CLAUDE.md 本就规定 `rustup update stable` 且钉 `>=1.88` 下限;CI 用 `@stable` 本就是更高版,升级是与 CI 对齐)。`rustup update stable` → rustc 1.97.0。随后暴露一个仅编译可见的测试期错误(`OpenPlan` 未 derive `Debug`,`expect_err` 需要),已修。四门在本机全绿:**TS 435 + cargo test 26 + clippy --all-targets 零警告 + frontend build**。`src-tauri/Cargo.toml` 的 `rust-version` 已修正 1.88→1.95(sysinfo 抬升的真实底线)。**待办**:CLAUDE.md 工具链表的 "Rust >= 1.88" 宜同步为 >= 1.95(用户确认后我改,属钉定栈版本变更)。

<details><summary>原始阻塞记录（已解除,留档）</summary>

**现象**：本机所有出站 HTTPS 在 schannel TLS 握手阶段失败（`curl: (35) schannel: failed to receive handshake`）——crates.io、github.com、exa MCP 全部握手失败。主脑已亲自复现:`cargo fetch` 三次重试全部 `SSL/TLS connection failed`。

**影响范围（精确）**：
- **#11（类型化能力）新增三个 crate**:`sysinfo 0.39`、`arboard 3.6`、`tauri-plugin-opener 2` ——本机 `~/.cargo/registry/cache` 无缓存,拉不下来,于是**整个 `apps/desktop/src-tauri` crate 无法编译**。`cargo clippy` / `cargo test` **在本机跑不了**。
- 连带:**#12（exec 能力）及 M3 余下所有 Shell/Rust 工作**只要新增任何未缓存 crate,都会撞同一堵墙。已缓存的 crate(tauri / keyring / xcap / tokio / serde / tauri-plugin-dialog)不受影响。
- **不影响 TS 侧**:#11 的 TS 半（core/shared/cli）主脑已亲验三门全绿——**435 测试通过**（shared 120 + core 297 + cli 18,较基线 389 新增 46),typecheck + lint 干净,frontend build 成功。

**#11 当前状态**：代码实施完成,TS 全绿,**Rust 半仅经主脑人工 read-review**（三个 exec 结构良好、签名与 docs 研究一致、测试覆盖到位),但**未经 cargo 编译/clippy/test 验证**——因此 #11 尚不能判为收官,未提交、未关 issue。

**需要你做的（二选一或都做）**：
1. **在联网机器上跑 Rust 门**（最直接）——把仓库同步到能访问 crates.io 的机器,执行:
   ```
   pnpm --filter @taki/desktop build
   cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
   ```
   编译通过后请优先确认这几处签名（研究是文档验证、非编译验证）:`sysinfo` 的 `name()->&OsStr` / `parent()->Option<Pid>` / `memory()->u64`;`arboard::Error::ContentNotAvailable`;`tauri_plugin_opener::{open_url, open_path}` 自由函数路径且无需 `.plugin(init())`。有报错贴给我,我开返工轮。
2. **修本机 crates.io 可达性**（治本,惠及后续所有 Rust 工作）——schannel TLS 握手失败通常是:公司/代理网络的 TLS 拦截、系统时间偏差、或 curl/schannel 的 CA 问题。可尝试:(a) 给 cargo 配 `CARGO_HTTP_CHECK_REVOKE=false` 或改用 git CLI fetch;(b) 设 `[http] proxy` 若你在代理后;(c) 换用 rustls 后端的 cargo;(d) 检查系统时间。若你告诉我网络环境,我可给更具体的方案。

**我在等待期间的处置**：Rust/Shell 线停在此处（不盲目继续 #12 的 Rust 部分——它会撞同一堵墙,盲目开发违背协议）。我已把 #11 的 Rust 全部人工审读以降低你早上 cargo 循环的返工概率。**若还有不依赖新 crate、不依赖 Rust 编译的 TS 侧工作可推进,我会继续**;若 M3 剩余全部依赖 Rust 编译,则整条线在此等你。

**这不是代码缺陷,是环境阻塞。** 相关 memory:`takiagent-cargo-network-block`。
