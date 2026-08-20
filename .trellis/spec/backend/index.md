# Backend Development Guidelines

> Backend = the TS Agent Core (`packages/core`, Node 24) and the Rust Shell (`apps/desktop/src-tauri`, Tauri 2).

## Pre-Development Checklist

Before writing backend code:

1. Read `CLAUDE.md` (root) — architecture invariants, naming, size caps.
2. Read `CONTEXT.md` — use domain terms exactly (Capability, Permission Gate, Node, Workspace...).
3. Protocol change? Start in `packages/shared` (zod schema) — never declare message shapes locally.
4. New system action? It is a Capability: Rust implementation + permission entry + audit; TS side only gets a client stub.
5. Verify external library APIs against current docs (AI SDK 7 moves fast) — never from memory.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Where files go in `packages/core` and `src-tauri` |
| [Database Guidelines](./database-guidelines.md) | SQLite single-writer, wrapper, migrations |
| [Error Handling](./error-handling.md) | Structured tool errors, Rust error types, IPC error shape |
| [Quality Guidelines](./quality-guidelines.md) | Size caps, lint, tests, forbidden patterns |
| [Logging Guidelines](./logging-guidelines.md) | pino / tracing, audit log |
| [E2E Harness](./e2e-harness.md) | Headless `withStack` fixture; L1 (deterministic) + L2 (real-agent) dual-track per capability |
| [Permission Authorization](./permission-authorization.md) | Executable canonical governance contract: Core-owned durable Level/overrides/generation; extension-neutral identity/registry; complete Host projection, trusted local classification, stricter-only final enforcement/evidence; legacy deny migration; Home and real-process gates |
| [Server-Push & Connection Auth](./server-push-and-connection-auth.md) | Fan-out channel pattern (timeline/avatar, no Rust mirror for operator-only); per-generation reconnect restoration; connection auth vs Core governance vs Host final enforcement; loopback auto-trust (P3) fail-closed rules |
| [Host-Bound Operation Lifecycle](./host-operation-lifecycle.md) | Implemented Host-control wire/generation/routing foundation plus shared offline, unknown-outcome, explicit-resume, and Run Receipt rules |
| [Operator Config Store](./config-store.md) | Sparse Core-owned settings overlay; env > stored > default; config.* operator protocol, secret masking, typed refusals, live timing-policy validation and apply truthfulness |
| [Agent Runtime](./agent-runtime.md) | Persist full turn (tool-call/result) or hallucinate; base-prompt truthfulness floor; test the deterministic root cause; presentation vs informational tool taxonomy (stopWhen, not result shape); untrusted external content enters prompts only through the A1 fence (scrub-then-fence at the sense seam); ambient observation = two independent privacy layers + fail-closed + silent-when-off + swept retention; time enters prompts from core/time only, stable-early/volatile-late |
| [Tool Design Standard](./tool-design.md) | The governance contract every new `*-tool.ts` follows: naming / description / schema / result-error / idempotency / birth-checklist rules, each sourced (Anthropic/OpenAI/MCP/OpenClaw/Hermes); strict-ready authoring |
| [MCP Tool Schema Compatibility](./mcp-tool-schema-compatibility.md) | Definition-stage nullable normalization, per-tool isolation, warning privacy, and provider-boundary tests |
| [Secure MCP Lifecycle](./mcp-lifecycle.md) | Desired/operator/runtime state planes, marker-only secrets, token-gated candidates, generation leases/draining, sanitized diagnostics, and Home management truth |
| [Standard Skill Lifecycle](./skill-lifecycle.md) | Portable staged packages, bounded import, immutable publication, catalog generations/leases, confined resources, and disposable Home management |
| [Extension Discovery](./extension-discovery.md) | Unified host-qualified MCP/Skill/capability discovery, immutable Run snapshots, explicit transfer routing, and final convergence evidence |
| [Secret Catalog](./secret-catalog.md) | Implemented host-local encrypted credential store: TSC1 secretstream envelope, versioned master-key sources (systemd / taki-secret-key helper), operator-only write-only sensitive path, locked fail-closed semantics, AC4 migration ordering |

## Quality Check (run before handing off)

- `pnpm -r typecheck && pnpm lint && pnpm -r test` green (lint is the ROOT script — `pnpm -r lint` matches zero packages and false-greens)
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` green
- No architecture invariant violated (esp. invariant 1: no OS access from TS)

**Language**: All documentation in **English**.
