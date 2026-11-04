# Backend Development Guidelines

> Backend = the TS Agent Core (`packages/core`, Node 24) and the Rust Shell (`apps/desktop/src-tauri`, Tauri 2).

## Pre-Development Checklist

Before writing backend code:

1. Read `CLAUDE.md` (root) — architecture invariants, naming, and size/responsibility guidance.
2. Read `CONTEXT.md` — use domain terms exactly (Capability, Permission Gate, Node, Workspace...).
3. Protocol change? Start in `packages/shared` (zod schema) — never declare message shapes locally.
4. New system action? It is a Capability: Rust implementation + permission entry + audit; TS side only gets a client stub.
5. Verify external library APIs against current docs (AI SDK 7 moves fast) — never from memory.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Where files go in `packages/core` and `src-tauri` |
| [Explicit Co-Watching and media entries](./co-watching.md) | Independent URL analysis, detected-viewing invitations, accepted single-video composition and existing Agent/Run/Delivery ownership |
| [Native recommendations and pre-analysis](./media-recommendations.md) | Native OpenBili reads/feedback, existing primary-source proof, bounded silent preparation and captured Skill/MCP disclosure |
| [Database Guidelines](./database-guidelines.md) | SQLite single-writer, wrapper, migrations, and fenced canonical Memory Replica synchronization |
| [SQLite Migration Lineage](./sqlite-migration-lineage.md) | Immutable recorded versions, guarded schema branches and convergence of historical SQLite schemas |
| [SQLite Transaction Failure Isolation](./sqlite-transaction-isolation.md) | Commit-failure rollback, nested savepoint boundaries and SQL isolation after an implicit whole-transaction abort |
| [Memory Replica Sync](./memory-replica-sync.md) | B5 transactional Authority/Bank guards, verified reconciliation and durable recovery; legacy derived-wait rules and G1 tracked native-result/checkpoint contracts |
| [G1 Native Result Recovery](./memory-native-result-recovery.md) | Tracked request identity, exact native historical proof, compact paging, old-row safety and actual SQLite factual confirmation; independent cutover boundaries |
| [Canonical Local Memory Runtime](./canonical-local-memory-runtime.md) | Exact primary-source ingestion, immutable Run/recall binding, complete Local maintenance, retirement durability and irreversible Legacy fencing |
| [Hindsight Native Runtime Reads](./hindsight-runtime-reads.md) | Authenticated native recall/reflect wire methods, lossless metadata, bounded responses and the separate Canonical hydration boundary |
| [Hindsight Application State and Runtime](./hindsight-application-runtime.md) | D77 original evidence, paired publication, immediate neutral policy, durable compound writes, source flush, guarded reflection and complete runtime lifetime |
| [Current Local Cutover Coverage](./memory-local-cutover-coverage.md) | Immutable complete Local manifests, writer-reserved cutover refusal, typed source evidence and exact native-object projection bindings |
| [Current-State Transfer and First Activation](./memory-current-state-cutover.md) | D78 structured Bank import, typed hash/mapping evidence, native input/outcome certificate, retained snapshot, drift invalidation and actual B4 raw staging/guards |
| [Durable Memory Operations](./memory-operations.md) | Core-owned operation owner over B3/B5 producers: single-flight families, Core-minted identity, derived settlement, stage-aware cancel, restart reconciliation, composite `memory.authority.status` read and the operations push channel |
| [Error Handling](./error-handling.md) | Structured tool errors, Rust/IPC errors, and Hindsight total-deadline/abort/response contracts |
| [Quality Guidelines](./quality-guidelines.md) | Size/responsibility guard, lint, tests, forbidden patterns |
| [Logging Guidelines](./logging-guidelines.md) | pino / tracing, audit log, and non-interfering provider instrumentation |
| [E2E Harness](./e2e-harness.md) | Headless `withStack` fixture; L1 (deterministic) + L2 (real-agent) dual-track per capability |
| [Permission Authorization](./permission-authorization.md) | Executable canonical governance contract: Core-owned durable Level/overrides/generation; extension-neutral identity/registry; complete Host projection, trusted local classification, stricter-only final enforcement/evidence; legacy deny migration; Home and real-process gates |
| [Operation Presentation](./operation-presentation.md) | Chinese capability/tool/approval names, current-target approval labels, immutable per-Run display-name capture, safe Timeline metadata and unchanged canonical replay |
| [Foreground Chat Activity](./foreground-chat-activity.md) | Ordered invocation facts, queue-owned bounded recovery, canonical step capture and atomic Timeline presentation handoff |
| [Command Approval Disclosure](./command-approval-disclosure.md) | Complete masked exec command, typed chunk reconstruction, operator offer/echo, credential-preserving Host-v3 ACK refusal and unchanged one-shot execution/audit binding |
| [Server-Push & Connection Auth](./server-push-and-connection-auth.md) | Fan-out, opt-in Perception/extension invalidations, pause deadline observation, generation restoration, auth and shutdown cleanup |
| [Host-Bound Operation Lifecycle](./host-operation-lifecycle.md) | Implemented Host-control wire/generation/routing foundation plus shared offline, unknown-outcome, explicit-resume, and Run Receipt rules |
| [Operator Config Store](./config-store.md) | Sparse Core-owned settings overlay; env > stored > default; config.* operator protocol, secret masking, typed refusals, live timing-policy validation and apply truthfulness |
| [Agent Runtime](./agent-runtime.md) | Complete turn/tool fidelity, primary native image input, truthful prompts, late transient context and provider-neutral dispatch |
| [Native Image Input](./native-image-input.md) | Single main model, native screenshot projection, retained refs/pressure and bounded ambient lifetimes without translators |
| [Shared Agent Delegation](./shared-agent-delegation.md) | Private reusable child context, exact input Effect receipts, independent controls, read-only child Memory, completion inference and original-request publication |
| [Private Worker Context](./private-worker-context.md) | Child-only pressure compaction, same-Attempt SDK segments, exact input/summary receipts, durable raw paging and bounded retained references |
| [Private Worker Check-ins](./private-worker-checkin.md) | Durable model-step intervals, exact continuation and user escalation, source-owned pause compatibility and truthful cumulative usage |
| [Private Agent Inbox](./private-agent-inbox.md) | Continuing events/input waits, flat parent intents, Core-owned historical retry identity, exact receipts and private Chat read/activity contracts |
| [Initiative Runtime and Delivery](./initiative-runtime.md) | Thin immutable context, primary admission reservation, structural decisions, same-Attempt continuations, atomic quotas/Timeline and mixed-version recovery |
| [Accepted Work Lifecycle](./accepted-work-lifecycle.md) | Trusted immutable-purpose quiescent wait/resume, existing Run authority, strict v3 lifecycle facts and fail-closed restart classification |
| [Interaction Patterns and Wake Composition](./interaction-patterns.md) | Exact review/source authority, finite current Signals, shared C1 policy, bounded context, explicit Skill setup and same-Monitor diagnostics |
| [Finite Initiative Intentions](./initiative-intentions.md) | Trusted primary source, finite windows, exact Run claims and terminal no-replay semantics |
| [Qualified Feedback Backoff](./initiative-backoff.md) | Durable weak evidence, real engagement/operator reset and conservative admission spacing/day ceilings |
| [User Timezone Authority](./user-timezone.md) | Existing singleton, authenticated designated-device reports, revision fencing and future-only user-zone schedule recomputation |
| [Accepted Perception Evidence](./perception-evidence.md) | Nullable native idle, consent/source epochs, post-await Host fencing and retirement without stale cache reuse |
| [User Presence and Response Opportunity](./user-presence.md) | Authenticated independent source leases, committed text exposure, same-device interval unions and durable feedback |
| [Compaction Harness](./compaction-harness.md) | Complete projected-input pressure, deterministic replay reduction/remeasurement, summary quality, durable retry/cooldown, fenced CAS lifecycle, and privacy-safe transcripts |
| [Run Observability Projection](./observability-projection.md) | Read-only Run/Event projections, bounded keyset cursors, monitor modes, semantic/inspector privacy boundary, and connection-scoped backfill/live subscriptions |
| [Final Request Attribution](./request-attribution.md) | Construction-owned categories/suppliers, final native dispatch and exact Effect correlation, real-window units and honest heuristic coverage |
| [Tool Design Standard](./tool-design.md) | Naming/description/schema/result/error/idempotency contracts; family-owned model projections preserve useful selectors, source meaning, raw collectors and unknown third-party outputs; sourced strict-ready authoring |
| [MCP Tool Schema Compatibility](./mcp-tool-schema-compatibility.md) | Definition-stage nullable normalization, per-tool isolation, warning privacy, and provider-boundary tests |
| [Secure MCP Lifecycle](./mcp-lifecycle.md) | Desired/operator/runtime state planes, marker-only secrets, token-gated candidates, generation leases/draining, sanitized diagnostics, and Home management truth |
| [Standard Skill Lifecycle](./skill-lifecycle.md) | Portable staged packages, bounded import, immutable publication, catalog generations/leases, confined resources, and disposable Home management |
| [Extension Discovery](./extension-discovery.md) | Unified host-qualified MCP/Skill/capability discovery, immutable Run snapshots, explicit transfer routing, and final convergence evidence |
| [Skill and MCP Tool Disclosure](./tool-disclosure.md) | Current-generation Skill bundles and exact MCP schemas through SDK activeTools; captured loaders, unchanged governance/connections, wire tests and bounded discovery |
| [Secret Catalog](./secret-catalog.md) | Implemented host-local encrypted credential store: TSC1 secretstream envelope, versioned master-key sources (systemd / taki-secret-key helper), operator-only write-only sensitive path, locked fail-closed semantics, AC4 migration ordering |

## Quality Check (run before handing off)

- `pnpm -r typecheck && pnpm lint && pnpm -r test` green (lint is the ROOT script — `pnpm -r lint` matches zero packages and false-greens)
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` green
- No architecture invariant violated (esp. invariant 1: no OS access from TS)

**Language**: All documentation in **English**.
