# TakiAgent

面向 Windows 的桌面 AI 智能体，将对话、长期记忆、桌面操作、主动互动与 Live2D 展示结合在一起。支持接入自选模型服务、导入模型资源，并通过 MCP 和 Skills 扩展能力。

## 主要功能

- **对话与模型接入**：支持文字和图片输入、连续聊天记录，以及 OpenAI 兼容接口的模型服务；可在设置中管理模型地址、名称和凭据。
- **长期记忆**：保存和检索相关信息，支持记忆维护与管理；提供本地记忆系统，也可接入 Hindsight 服务。
- **桌面操作**：查看屏幕、列出进程、读写剪贴板、打开链接或文件、执行命令；操作受原生权限系统管理，可审批或拦截。
- **主动互动与定时任务**：根据配置的活动信号、互动规则和定时任务进行提醒或后续跟进，支持冷却时间、频率限制和静默时段。
- **子代理协作**：将任务委派给后台子代理，支持消息沟通、工作状态查询和结果汇总，并提供独立的子代理管理页面。
- **MCP 与 Skills 扩展**：管理外部 MCP 服务、查看工具连接状态，安装和启用技能包，组合所需能力。
- **Live2D 桌面展示**：导入模型、切换装扮、播放表情和动作，并调整桌面形象的大小、透明度和交互效果。
- **感知与隐私控制**：配置活动采样和截图开关，通过隐私暂停停止活动采样及其触发来源。
- **运行管理**：集中管理模型、权限、记忆和扩展配置，查看智能体运行记录；可选接入 QQMessageMonitor 查看 QQ 消息历史。

## 项目结构

采用 TypeScript 智能体核心、Rust/Tauri 桌面壳和 React/PixiJS/Live2D 界面。核心负责应用状态与数据库写入，桌面壳负责系统能力和权限，界面通过 WebSocket/JSON-RPC 访问核心。核心独立运行，关闭桌面窗口不会直接结束核心进程。

| 目录 | 用途 |
| --- | --- |
| `packages/core/` | 智能体、工具、记忆、调度、配置和数据存储 |
| `packages/shared/` | 共享协议类型与运行时校验 |
| `apps/desktop/` | Tauri 桌面壳与 React/Live2D 界面 |
| `apps/cli/` | 连接核心的终端客户端 |
| `apps/hindsight-host/` | Hindsight 本机托管支持 |
| `prompt/` | 系统提示与可配置的人格卡片 |
| `integrations/` | 可选媒体及外部服务集成 |
| `e2e/` | 端到端检查 |
| `docs/` | 产品、架构和设计文档 |

## 本地开发

需要 Windows、Node.js **24+**、pnpm **10.22.0**、Rust **1.95+**（MSVC 工具链）、Windows C++ 构建工具和 WebView2。

**安装前提**：桌面端目前依赖 QQMessageMonitor 的本地包 `qqmm-management-client-0.1.0.tgz`。请先按[桌面端依赖配置](apps/desktop/package.json)与 `pnpm-lock.yaml` 中的路径准备该文件；仅克隆本仓库不能提供该依赖。

在仓库根目录安装依赖：

```powershell
pnpm install --frozen-lockfile
```

下载本地开发所需的 Live2D 运行时：

```powershell
node scripts/vendor-live2d-runtimes.mjs
```

模型资源需自行准备，通过桌面界面导入，并遵守对应模型与运行时的授权要求。专有开发资源不应提交到 Git 或包含在发布包中。

在一个终端启动智能体核心：

```powershell
pnpm core:dev
```

在另一个终端启动桌面界面：

```powershell
pnpm desktop:dev
```

启动后，在主界面的设置中配置模型地址、名称和凭据。未配置模型时仍可访问基础配置服务，依赖模型的功能需要可用的模型服务。桌面界面与核心应使用同一数据目录。

数据默认保存在 `~/.takiagent/`，可通过 `TAKI_DATA_DIR` 指定其他目录。两个开发启动入口都会读取仓库中可选的 `.env.local`。Hindsight 为可选的外部记忆服务，其额外需求见[部署资源说明](docs/DEPLOYMENT-RESOURCES.md)。

## 开发检查

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

## 相关文档

- [文档索引](docs/index.md)
- [领域术语](CONTEXT.md)
- [产品定义](docs/PRODUCT.md)
- [技术栈](docs/TECH-STACK.md)
- [架构决策](docs/adr/)
