# TakiAgent (ShiinaTaki)

A Windows desktop AI Companion powered by a local agent runtime and a Live2D character. The default Character is Shiina Taki (椎名立希); conversations use your configured OpenAI-compatible model provider.

## Overview

- Live2D desktop pet, character/model import, and a shared chat timeline.
- Persistent conversations and memory, with Local and Hindsight provider support.
- Desktop capabilities governed by the native Permission Gate.
- MCP servers and Skills for extending the agent.
- Configurable activity Sampling, proactive interactions, and Privacy Pause.

The TypeScript Agent Core owns application state and database writes. The Rust/Tauri Shell handles native capabilities and permissions. React/PixiJS/Live2D clients communicate with Core over WebSocket/JSON-RPC. Core runs independently of the desktop windows.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/core/` | Agents, tools, memory, scheduling, configuration, and persistence |
| `packages/shared/` | Shared protocol types and runtime schemas |
| `apps/desktop/` | Tauri Shell and React/Live2D desktop interface |
| `apps/cli/` | Terminal client for Core |
| `apps/hindsight-host/` | Native Hindsight hosting support |
| `prompt/` | System guidance and Character persona cards |
| `integrations/` | Optional media and external-service integrations |
| `e2e/` | End-to-end checks |
| `docs/` | Product, architecture, and design records |

## Local development

Use Windows with Node.js **24+**, pnpm **10.22.0** (the pinned package-manager version), Rust **1.95+** with the MSVC toolchain, Windows C++ build tools, and WebView2.

**Installation prerequisite:** Desktop currently depends on a local QQMessageMonitor package archive, `qqmm-management-client-0.1.0.tgz`. Prepare it at the external path referenced by [the Desktop manifest](apps/desktop/package.json) and `pnpm-lock.yaml` before installing. A clone of this repository alone does not supply that archive.

Install dependencies from the repository root:

```powershell
pnpm install --frozen-lockfile
```

For Live2D development, download the runtime files:

```powershell
node scripts/vendor-live2d-runtimes.mjs
```

Character models are not included. Import your own assets through the desktop interface and follow the applicable model and runtime licenses. Proprietary development assets must stay out of Git and release bundles.

Start Core in one terminal:

```powershell
pnpm core:dev
```

Start Desktop in another terminal:

```powershell
pnpm desktop:dev
```

Configure the model endpoint, model name, and credentials in Home settings. Core's basic configuration services can start before a model is configured; model-dependent features require a ready provider. Local Desktop and Core should use the same data directory.

Application data defaults to `~/.takiagent/`; set `TAKI_DATA_DIR` to select another profile. Both development launchers read the repository's optional `.env.local`. Hindsight is an optional external memory service; see [deployment resources](docs/DEPLOYMENT-RESOURCES.md) for its additional requirements.

## Checks

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

## Documentation

- [Documentation index](docs/index.md)
- [Domain glossary](CONTEXT.md)
- [Product definition](docs/PRODUCT.md)
- [Technology stack](docs/TECH-STACK.md)
- [Architecture decisions](docs/adr/)
