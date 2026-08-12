# Research: Taki memory integration seams

- Query: Map the live TakiAgent memory subsystem, its execution/data-flow seams, and the constraints a later Hindsight Memory Provider integration must respect. Explicitly verify the current provider-secret and deployment boundary for a guided setup flow.
- Scope: internal
- Date: 2026-08-09

## Findings

### Executive conclusion

The live memory system is a single, local, synchronous subsystem owned by the TypeScript Agent Core. Markdown entry files are authoritative, SQLite metadata/FTS is derived and rebuildable, retrieval is exposed only through the foreground `memory_search` tool, stable memory context is assembled synchronously before each model request, and committed turns start a detached serial chain for episodic writing, flush, tidy, and conversation compaction. There is no live `MemoryProvider`, `MemoryAuthority`, Canonical Memory Record, replica checkpoint, migration ledger, Pending Memory outbox, bank model, or Hindsight adapter under `packages/` or `apps/`.

The guided-setup prerequisite gap is concrete rather than hypothetical. Core model/API keys are consumed from its process environment. The ordinary config plane deliberately excludes secret values, reports only environment-derived presence, and refuses secret writes. The Rust keyring exists in the desktop Shell, but its live consumers are only the Shell node's reconnect token and stable device id. The Shell connects to an already-running Core; its Tauri startup and bundle configuration do not launch or package Core. Therefore the current settings UI can display secret presence but cannot set or clear a model/Hindsight credential, and a managed Hindsight deployment cannot be performed through any existing Core or Shell startup path.

### Files found

| File | Live responsibility |
| --- | --- |
| `packages/core/src/main.ts` | Core composition root: opens the boot/config plane, creates the memory subsystem, injects it into chat, registers operator methods, and owns shutdown. |
| `packages/core/src/boot/core-bootstrap.ts` | Opens the data root/database, resolves `env > stored > default`, and constructs the foreground model slots. |
| `packages/core/src/memory/bootstrap.ts` | Memory composition root for engine, Utility Slot, automatic writers, tidy, compaction, startup reconcile, and retention. |
| `packages/core/src/memory/memory-engine.ts` | Local engine façade over store, index, retriever, assembler, tools, retention, tidy, and same-layer dedupe. |
| `packages/core/src/memory/store.ts` | Authoritative Markdown entry storage and global/per-character directory placement. |
| `packages/core/src/memory/indexer.ts` | File-to-SQLite reconciliation and per-write index projection. |
| `packages/core/src/db/memory-repo.ts` | Derived metadata/FTS repository, scope filtering, BM25 ordering, and lookup SQL. |
| `packages/core/src/db/migrations/index-list.ts` | Explicit ordered migration registry for memory, auto-write state, events, tidy state, summaries, and config. |
| `packages/core/src/memory/layer-registry.ts` | Declarative ownership, write, recall, truncation, and retention policy for five memory layers. |
| `packages/core/src/memory/block-registry.ts` | Declarative always-visible Memory Block ownership, writer, ordering, and token budgets. |
| `packages/core/src/memory/block-store.ts` | Fresh per-turn block reads and writer/ownership enforcement. |
| `packages/core/src/memory/retriever.ts` | Synchronous retrieval interface used by the local engine. |
| `packages/core/src/memory/fts5-retriever.ts` | Local FTS5/BM25 implementation behind `Retriever`. |
| `packages/core/src/memory/assembler.ts` | Stable prompt-memory assembly; intentionally contains no retrieved-memory section. |
| `packages/core/src/agents/chat-agent.ts` | Per-turn instruction/tool construction, ephemeral turn tail, persistence, and detached post-turn memory triggers. |
| `packages/core/src/memory/memory-tools.ts` | Foreground/background memory tool contracts and automatic-writer restrictions. |
| `packages/core/src/memory/auto-memory.ts` | Per-character serialized post-turn chain and success-only watermarks. |
| `packages/core/src/memory/write-convention.ts` | Shared behavior-change Write Gate and first-person memory-writing convention. |
| `packages/core/src/memory/tidy-pass.ts` | Threshold/operator-triggered local store maintenance on the Utility Slot. |
| `packages/core/src/agents/compaction-pass.ts` | Flush-first rolling conversation-summary compaction. |
| `packages/core/src/memory/retention-sweeper.ts` | Declarative archive/delete policy execution. |
| `packages/core/src/config/provider-config.ts` | Required foreground provider base URL, API key, and model parsed from Core environment. |
| `packages/core/src/config/config-source.ts` | Effective config resolution and masked operator projection. |
| `packages/core/src/config/config-writer.ts` | Sparse non-secret config writer; explicitly refuses secret values. |
| `packages/core/src/config/knob-registry.ts` | Operator-visible knob metadata, including three secret-classified API-key rows. |
| `packages/shared/src/config-schema.ts` | Current `config.list/set/subscribe/changed` wire contract; no secret set/clear method. |
| `packages/shared/src/memory-schema.ts` | Current counts-only `memory.tidy` and `memory.status` operator contract. |
| `apps/desktop/src-tauri/src/secrets.rs` | Shell-local `SecretStore` and Windows Credential Manager adapter. |
| `apps/desktop/src-tauri/src/node.rs` | Builds the Shell capability node and stores its device id through the injected `SecretStore`. |
| `apps/desktop/src-tauri/src/ws_client.rs` | Uses the Shell `SecretStore` for the node reconnect token. |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri Shell composition root; creates a WS client for an existing Core and injects `KeyringStore`. |
| `apps/desktop/src-tauri/tauri.conf.json` | Desktop build/bundle configuration; starts Vite only and declares no Core sidecar/external binary. |
| `apps/desktop/src/windows/home/pages/settings/knob-editor.ts` | Makes secret rows read-only and renders set/not-set presence. |
| `apps/desktop/src/lib/cache-persist.ts` | Allow-listed UI cache with a second secret-row scrubber. |
| `docs/MEMORY-DESIGN.md` | Separates current file-first/tool-only behavior from the target automatic-recall/provider architecture. |
| `docs/adr/0009-single-memory-authority-with-local-replica.md` | Target-state authority, replica, Pending Memory, setup, and synchronization decision record; not live implementation. |

### Current execution and data flow

1. **Core boot.** `bootstrapCore(process.env)` opens the data directory and SQLite database, applies migrations, builds the effective configuration view, and constructs the foreground models (`packages/core/src/main.ts:83-86`; `packages/core/src/boot/core-bootstrap.ts:50-89`). `createMemorySubsystem` then loads memory/Utility configuration, builds the local engine, reconciles the derived index from files, wires auto-write/tidy/compaction, and starts retention (`packages/core/src/main.ts:113-133`; `packages/core/src/memory/bootstrap.ts:65-121`, `129-150`).
2. **Foreground turn construction.** Each attempt synchronously reads conversation history, assembles stable memory instructions, creates character-bound memory tools, and appends only time plus the synchronous `volatileContext` string to `<turn-context>` (`packages/core/src/agents/chat-agent.ts:165-203`, `330-339`, `372-386`). The memory assembler emits persona, emotion, Memory Blocks, pinned rows, and at most one intention; its retrieved section is explicitly absent (`packages/core/src/memory/assembler.ts:55-75`).
3. **Foreground retrieval.** The local retriever is reachable through `memory_search`; the engine does not call it during ordinary assembly (`packages/core/src/memory/memory-engine.ts:82-103`, `131-145`; `packages/core/src/memory/memory-tools.ts:147-159`).
4. **Commit and detached upkeep.** After model output is persisted and the turn is not retracted, the agent fires `autoMemory.onTurnCompleted` without awaiting it (`packages/core/src/agents/chat-agent.ts:225-257`). Per character, overlapping triggers serialize into `episodic -> flush -> tidy -> compact`; failures are logged and watermarks advance only on success (`packages/core/src/memory/auto-memory.ts:73-100`, `130-167`).
5. **Operator maintenance.** Core exposes only `memory.tidy` and `memory.status`, both operator-only and counts-only; the Home operations page invokes those request/response methods (`packages/shared/src/memory-schema.ts:9-78`; `packages/core/src/server/methods/memory-tidy.ts:15-32`; `packages/core/src/server/methods/memory-status.ts:24-34`; `apps/desktop/src/windows/home/pages/operations/use-operations.ts:28-74`).
6. **Shutdown and client lifetime.** Core closes WS, MCP children, and SQLite on its own signals (`packages/core/src/main.ts:381-390`). The Tauri Shell runs a long-lived WS node on its own runtime, and closing a WebView does not stop it (`apps/desktop/src-tauri/src/lib.rs:81-96`). UI windows are disposable clients; they do not own memory or Core lifetime.

### Code patterns and implementation seams

#### 1. Composition root and local engine boundary

- `createMemorySubsystem` is the single production assembly point for current memory concerns and returns `engine`, `autoMemory`, `utility`, `tidy`, `memoryRoot`, and a bound write operation (`packages/core/src/memory/bootstrap.ts:52-63`, `65-121`).
- `MemoryEngine` is the foreground-facing façade, but it represents one concrete local implementation and exposes synchronous `assemble`, tool factories, and direct writes rather than a provider-neutral authority contract (`packages/core/src/memory/memory-engine.ts:50-79`, `82-122`).
- The engine constructs its own store, repository, tokenizer, FTS retriever, assembler, and event repository. These are not injected provider capabilities (`packages/core/src/memory/memory-engine.ts:82-103`).
- Later provider work must distinguish the stable Taki policy surfaces (layer/block registries, prompt projection, write eligibility) from this local storage/maintenance implementation. The current façade cannot by itself express remote health, authority state, async recall, revisioned mutation, replica lag, or pending writes.

#### 2. Persistence and source of truth

- SQLite is opened in WAL mode and migrations run at boot (`packages/core/src/db/sqlite.ts:39-47`). Memory-related migrations are explicit and ordered: derived entries/FTS, automatic-write watermarks, origin, events, unicode61/search terms, search counts, tidy watermark, and rolling summary (`packages/core/src/db/migrations/index-list.ts:7-34`).
- A memory write creates an atomic Markdown file with validated frontmatter, then indexes it; global and per-character ownership determine the directory (`packages/core/src/memory/store.ts:126-145`, `183-201`).
- Startup reconcile walks files, upserts changed/new entries, removes orphaned index rows, and leaves invalid files on disk but unindexed (`packages/core/src/memory/indexer.ts:25-57`).
- Search scope is active, unexpired, and global-or-current-character. MATCH uses configured BM25 weights; LIKE is the degenerate fallback (`packages/core/src/db/memory-repo.ts:89-121`, `138-188`).
- The current local store has no canonical structured source/fact/observation identity. Its file path is the derived-row primary identity, so deterministic one-source-to-many migration needs an explicit mapping outside this current schema.

#### 3. Taki policy registries and Memory Blocks

- Five layers are declarative data with ownership, writer, recall, truncation, and retention policy. Foreground- and automatic-writable sets are derived from those rows (`packages/core/src/memory/layer-registry.ts:18-78`, `86-100`).
- Three Memory Blocks are separately registered with ownership, declared writer, injection order, and token budget (`packages/core/src/memory/block-registry.ts:27-63`). They are fresh-read Markdown outside the entry tree and cannot enter FTS (`packages/core/src/memory/block-store.ts:31-75`, `84-95`).
- Block writer and scope enforcement occur at the store boundary (`packages/core/src/memory/block-store.ts:58-74`). These policies remain Taki-owned even if a later authority provider owns general extraction, semantic maintenance, and recall.

#### 4. Retrieval and prompt projection

- `Retriever.retrieve` is synchronous and returns local `RankedEntry[]` (`packages/core/src/memory/retriever.ts:10-31`). The FTS5 implementation builds a safe segmented query, over-fetches up to 50 candidates, layer-filters, and trims (`packages/core/src/memory/fts5-retriever.ts:11-44`).
- Query terms are OR-joined FTS literals with escaped LIKE fallback; CJK segmentation uses one `Intl.Segmenter("zh")` instance shared by index and query paths (`packages/core/src/memory/fts5-query.ts:11-21`; `packages/core/src/memory/search-tokenizer.ts:30-53`).
- The assembler intentionally excludes retrieved rows, and chat assembly is synchronous (`packages/core/src/memory/assembler.ts:63-75`; `packages/core/src/agents/chat-agent.ts:165-203`). The only generic ephemeral seam, `volatileContext(now): string`, is also synchronous (`packages/core/src/agents/chat-agent.ts:330-339`).
- Consequently, live code has no non-blocking async seam for a network Hindsight recall before foreground generation. Automatic Recall in `docs/MEMORY-DESIGN.md:117-121` is target behavior, not current behavior.

#### 5. Agent-facing tools

- Foreground tools are `memory_write`, `memory_search`, and `memory_archive`; background tools reuse those names but restrict writable layers and clamp importance (`packages/core/src/memory/memory-tools.ts:51-70`, `72-145`).
- Search and archive return structured success/error envelopes. Observed memory content is fenced before it re-enters the model (`packages/core/src/memory/memory-tools.ts:147-199`).
- The toolset is reconstructed and merged into each foreground turn (`packages/core/src/agents/chat-agent.ts:173-182`). No current tool expresses reflect, edit, invalidate, restore, provider capabilities, retryability, authority state, or asynchronous operation identity.

#### 6. Write Gate and automatic ingestion

- The common eligibility rule is behavior-change based, explicitly permits silence, honors explicit remember requests, and requires first-person, source-grounded phrasing (`packages/core/src/memory/write-convention.ts:14-33`).
- Episodic writing asks for zero to three JSON entries and writes them locally; an empty array is normal (`packages/core/src/memory/episodic-writer.ts:31-80`). Flush runs a silent tool loop and counts only successful `memory_write` results (`packages/core/src/memory/flush-writer.ts:22-59`).
- The automatic chain is detached, per-character serialized, and success-watermarked (`packages/core/src/memory/auto-memory.ts:73-100`, `130-167`). The local engine performs same-layer lexical dedupe and reinforces the existing file/index row (`packages/core/src/memory/memory-engine.ts:211-237`).
- In the current implementation the model-generated summary is the stored memory. There is no seam that submits an original safe conversation span plus provenance to an authority provider and receives one-to-many facts.

#### 7. Tidy, compaction, and retention

- Tidy runs when write count crosses a configured threshold or an operator invokes `runNow`; a clean report uses zero model calls, and only a successful model pass advances its watermark (`packages/core/src/memory/tidy-pass.ts:108-149`). Maintenance tools are deliberately separate from the foreground toolset (`packages/core/src/memory/memory-engine.ts:39-48`, `155-163`).
- Compaction triggers against the replay wall, flushes the retiring span first, keeps the newest configured tail, and advances the summary only after non-empty successful generation (`packages/core/src/agents/compaction-pass.ts:125-208`).
- Retention is registry-driven. Activity is the one hard-delete policy; expired intentions and decayed episodes archive reversibly. A boot sweep and unreferenced six-hour interval drive it (`packages/core/src/memory/retention-sweeper.ts:37-98`; `packages/core/src/scheduler/sweep-runner.ts:29-36`).
- Generic local tidy/consolidation and provider-native Hindsight maintenance cannot both remain authoritative without duplicating extraction and mutation. The target division in ADR 0009 must be treated as future design, not inferred from these current passes.

#### 8. Provider configuration and the current secret gap

- Foreground provider configuration requires `TAKI_PROVIDER_BASE_URL`, `TAKI_PROVIDER_API_KEY`, and `TAKI_PROVIDER_MODEL` from the environment-shaped input and passes the key directly to `createOpenAICompatible` (`packages/core/src/config/provider-config.ts:8-24`; `packages/core/src/config/provider-factory.ts:20-38`). The optional Utility Slot follows the same all-or-nothing environment pattern (`packages/core/src/config/utility-config.ts:24-32`).
- Core boot captures the real process environment, overlays only eligible non-secret stored values, and passes that resolved view to loaders (`packages/core/src/boot/core-bootstrap.ts:68-96`). `ConfigSource.env()` explicitly skips secrets, while `effectiveAll()` computes `secretSet` only from a non-empty process environment variable and always emits `value: null` (`packages/core/src/config/config-source.ts:60-105`).
- The config writer refuses every secret-classified row before any database mutation (`packages/core/src/config/config-writer.ts:35-65`). The shared wire contract contains only `config.list/set/subscribe/changed`; secret values cannot be sent, and presence is the only secret field (`packages/shared/src/config-schema.ts:9-13`, `36-80`).
- The registry marks exactly the main, vision, and Utility API keys as secrets, but its comments describe Credential Manager as an owner that Core does not actually integrate (`packages/core/src/config/knob-registry.ts:37-48`, `134-143`). The settings UI therefore disables the editor and shows only set/not-set with the text `密钥存于系统凭据管理器` (`apps/desktop/src/windows/home/pages/settings/knob-editor.ts:26-43`; `apps/desktop/src/windows/home/pages/settings/knob-input.tsx:40-47`). This is a UI/contract aspiration, not evidence of a provider-key write path.
- UI persistence has a separate defense: config snapshots are allow-listed and secret rows are removed before `localStorage` writes (`apps/desktop/src/lib/cache-persist.ts:11-45`, `59-70`).

#### 9. Rust keyring ownership is Shell-node-only

- `KeyringStore` is a generic key/value wrapper over `keyring`/Windows Credential Manager, but the module declares its live purpose as node-token persistence and names only `node-token` and `device-id` (`apps/desktop/src-tauri/src/secrets.rs:1-20`, `41-59`).
- `node::build_node` obtains or creates `device-id` through the injected store and places that same store on the Shell WS client (`apps/desktop/src-tauri/src/node.rs:29-44`, `68-104`, `120-128`).
- `WsClient` reads, writes, and deletes only `node-token` during Core pairing/reconnection (`apps/desktop/src-tauri/src/ws_client.rs:26-36`, `86-114`).
- Tauri injects `KeyringStore` into this capability-node composition (`apps/desktop/src-tauri/src/lib.rs:120-135`). There is no shared protocol or Core adapter that can request provider-key get/set/delete, and `packages/core` contains no `SecretStore`/keyring implementation.
- A Hindsight setup wizard therefore currently has no supported operation for Hindsight API-key or model-provider credential set/clear/presence beyond environment-derived presence. The existing Rust type is not, by itself, a Core secret backend.

#### 10. Deployment and process boundary

- Architecture assigns providers, memory, tools, and scheduling to the headless Core, while the Shell owns OS actions and connects over WS (`CONTEXT.md:36-47`; `.trellis/spec/backend/directory-structure.md:23-38`).
- The Shell's setup hook builds a WS client pointed at `ws://127.0.0.1:8974` and spawns only that client's reconnect loop (`apps/desktop/src-tauri/src/node.rs:26-43`; `apps/desktop/src-tauri/src/lib.rs:81-96`, `120-135`). `main.rs` is only a shim (`apps/desktop/src-tauri/src/main.rs:1-6`).
- Root development scripts start Core and desktop independently (`package.json:11-18`). The Tauri build runs only `pnpm dev`/`pnpm build` for the desktop frontend, and the bundle declares no Core sidecar or external binary (`apps/desktop/src-tauri/tauri.conf.json:6-10`, `51-55`). A source search under `apps/desktop` finds no `@taki/core`, Core entrypoint, sidecar, or startup `Command` reference; the only process spawn implementation is the separately governed `exec` capability.
- This means the live Shell does **not** launch Core, and Core performs no Shell/Docker/service provisioning. An existing running Hindsight instance can conceptually fit the Core's connection side of the boundary, but no Hindsight configuration/client exists yet. Managed local deployment requires an operator-owned OS/deployment surface that is absent today; it cannot be treated as a hidden extension of Core boot.

#### 11. Operator protocol and UI surface

- Current memory protocol is request/response only: `memory.tidy` and `memory.status`, both operator-only and counts-only (`packages/shared/src/memory-schema.ts:9-78`). There is no memory-provider status, migration, sync, health, setup, secret, or server-push contract.
- Config has one generic push channel, `config.changed`, for stored non-secret changes (`packages/shared/src/config-schema.ts:9-14`). There is no memory-specific change producer/subscription. Project guidance says a snapshot without a producer is a read, not a channel (`.trellis/spec/backend/server-push-and-connection-auth.md:5-13`).
- The existing settings and operations hooks are metadata/read driven. They can be reference patterns for operator-only request/response and cached snapshots, but their current schemas cannot represent authority epoch, health, checkpoint, lag, pending operations, migration progress, or secret mutation.

#### 12. Lifecycle constraints for later provider work

- **Boot ordering is load-bearing:** migrations and config resolution happen before the memory subsystem; reconcile and the boot retention sweep happen before WS service is ready (`packages/core/src/boot/core-bootstrap.ts:68-105`; `packages/core/src/memory/bootstrap.ts:129-150`; `packages/core/src/scheduler/sweep-runner.ts:29-36`).
- **Foreground latency is isolated today:** stable memory assembly/tool construction are synchronous, while writes and maintenance are detached after commitment (`packages/core/src/agents/chat-agent.ts:165-203`, `236-257`). A remote provider must not be assumed to fit a synchronous interface.
- **Single writer remains a project invariant:** only Core opens the database; Shell/UI query over protocol (`.trellis/spec/backend/database-guidelines.md:5-13`). Any replica, ledger, outbox, authority, or checkpoint state belongs under Core ownership even when an OS-specific helper manages credentials or processes.
- **Client lifetime is non-authoritative:** UI cache is optional and scrubbed, and closing a window must not stop Core/background work (`apps/desktop/src/lib/cache-persist.ts:47-70`; `apps/desktop/src-tauri/src/lib.rs:89-91`). Setup progress that must survive window closure cannot exist only in React state.

### Constraints for the Hindsight setup wizard

These are prerequisites established by current code, not source-change proposals:

1. **Secret values cannot use `config.set`.** It is structurally and behaviorally forbidden; current presence reflects only Core launch environment.
2. **The existing Rust keyring is not reachable from Core and is scoped to Shell node identity.** Reusing the word “keyring” must not be mistaken for an existing provider credential path.
3. **Secret values must not appear in ordinary WS config rows, logs, memory, replicas, migration exports, or UI caches.** Existing masking/scrubbing behavior is already test-pinned.
4. **Core is OS-neutral and owns memory semantics/database state.** It can authenticate to and inspect a service, but current code provides no OS process/service/Docker manager.
5. **Shell does not launch Core.** A managed deployment flow cannot assume the Tauri app already supervises Core or can transitively expose Core environment variables.
6. **Existing-instance connection and managed provisioning are different availability boundaries.** The former must remain possible when Shell provisioning is unavailable, especially for headless/VPS Core deployments documented in `docs/TECH-STACK.md:77-80`.
7. **The present UI wording overstates implementation.** “Stored in system credential manager” is true only for Shell node credentials; provider-key rows are read-only environment-presence indicators today.

### Representative tests

| Test evidence | Contract pinned |
| --- | --- |
| `packages/core/src/memory/bootstrap.test.ts:58-121` | Boot reconcile, Workspace placement, Utility fallback/configuration, real engine write, and zero-call clean tidy. |
| `packages/core/src/memory/memory-engine.test.ts:27-56`, `71-135` | Files rebuild retrieval across restart; same-layer duplicate writes reinforce rather than duplicate. |
| `packages/core/src/memory/memory-tools.test.ts:39-108`, `131-206` | Tool scope, background clamps, character isolation, untrusted fencing, and search telemetry without query text. |
| `packages/core/src/agents/chat-agent.test.ts:108-235` | Post-turn memory is detached and runs only for committed/non-retracted outcomes. |
| `packages/core/src/memory/auto-memory.test.ts:125-581` | Thresholds, skips, retry watermarks, history/flush boundary equality, serialization, and maintenance ordering. |
| `packages/core/src/memory/tidy-pass.test.ts:81-229` | Trigger/operator execution, zero-cost clean exit, structural termination, success-only watermark, and counts-only output. |
| `packages/core/src/agents/compaction-pass.test.ts:111-275` | Trigger math, flush-first ordering, retry behavior, protected tail, and untruncated summary. |
| `packages/core/src/memory/retention-sweeper.test.ts:66-178` | Activity hard delete, reversible intention/episode archive, reinforcement recency, and counts-only logging. |
| `packages/core/src/server/methods/memory-tidy.test.ts:19-44` and `memory-status.test.ts:21-66` | Operator-only counts contracts and explicit prevention of memory/summary text crossing WS. |
| `packages/core/src/config/config-source.test.ts:78-135` | Stored secret exclusion, environment-only secret presence, and value masking. |
| `packages/core/src/config/config-writer.test.ts:25-82` | Secret/env/env-only/invalid refusals leave the store and push stream untouched. |
| `apps/desktop/src/windows/home/pages/settings/knob-editor.test.ts:43-61` | Secret rows are disabled and display set/not-set only. |
| `apps/desktop/src/lib/cache-persist.test.ts:107-114` | Secret config rows are stripped before UI persistence. |

### External references and versions

- This artifact maps live Taki code only. Exact Hindsight public API, deployment, authentication, logical-record, change-cursor, and supported-version contracts were not re-verified here and must be supplied by the separate Hindsight contract research before implementation.
- Current foreground model stack: `ai@7.0.17` and `@ai-sdk/openai-compatible@3.0.5` (`packages/core/package.json:13-23`). The current provider factory is OpenAI-compatible (`packages/core/src/config/provider-factory.ts:20-38`).
- Current desktop secret adapter: Rust `keyring = 4.1` with Tauri `2.11` (`apps/desktop/src-tauri/Cargo.toml:24-43`). The implementation identifies Windows Credential Manager as the platform store (`apps/desktop/src-tauri/src/secrets.rs:20-31`).
- Current runtime floors: Node `>=24`, pnpm `>=10`, Rust `1.95` (`package.json:6-9`; `apps/desktop/src-tauri/Cargo.toml:5-9`).
- `references/hermes-agent-main/plugins/memory/hindsight/` is reference material only; it is not imported by the production packages and is not evidence that Hindsight is integrated.

### Related specs and decisions

- `.trellis/spec/guides/source-grounding-guide.md:42-45` — disk/protocol claims must come from live code; uncited numbers must be flagged.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:59-69` — validate at boundaries and prevent storage-schema leakage across layers.
- `.trellis/spec/backend/database-guidelines.md:5-13` — Core-only SQLite writer, explicit migrations, Markdown-as-current-truth/FTS-as-derived.
- `.trellis/spec/backend/config-store.md:3-18`, `69-86`, `99-126` — config is not a secret store; presence currently comes from Core environment; secret writes are refused; Shell does not participate in generic config.
- `.trellis/spec/backend/directory-structure.md:23-38` — Core/Shell/shared ownership and thin boundary rules.
- `.trellis/spec/backend/agent-runtime.md:34-58`, `170-203` — model-slot fail-fast behavior, detached memory bridge precedent, and operator-only single-writer privacy controls.
- `.trellis/spec/backend/tool-design.md:168-181`, `220-225` — bounded/fenced results and thin one-registration tool wiring.
- `.trellis/spec/backend/server-push-and-connection-auth.md:5-30` — request/read versus real producer-backed push and reconnection restoration.
- `.trellis/spec/frontend/state-management.md`, `hook-guidelines.md`, and `component-guidelines.md` — operator UI remains a disposable projection, with protocol work in hooks and presentation separate.
- `docs/MEMORY-DESIGN.md:117-151` — explicitly labels current tool-only recall and target automatic provider recall/upgrade path.
- `docs/adr/0009-single-memory-authority-with-local-replica.md:1-57` — accepted target authority/replica/setup/synchronization decisions; do not report them as implemented.
- `.trellis/tasks/08-09-hindsight-memory-provider/prd.md:99-123` and `info.md:249-285` — task-level setup, secret, and deployment requirements that this live-code map substantiates.

## Caveats / Not Found

- No live `MemoryProvider`, `MemoryAuthority`, Canonical Memory Record, Hindsight bank, authority epoch, migration ledger, replica checkpoint, Pending Memory/outbox, sync scheduler, or Hindsight client was found under `packages/` or `apps/`.
- No Automatic Memory Recall is implemented. `Retriever` is synchronous and used by `memory_search`; `volatileContext` is synchronous and currently carries perception/time only.
- No memory-provider WS push/event channel exists. Current memory operator methods are request/response and counts-only.
- No provider-neutral Core secret backend, secret set/clear protocol, or provider-key keyring consumer exists. `secretSet` is environment-derived presence only.
- The Rust keyring's live keys are `node-token` and `device-id`; the settings UI's Credential Manager wording is broader than the implementation.
- The Tauri Shell does not launch or bundle Core. Core and desktop are separate development processes, and the production bundle declares no Core sidecar.
- `docs/MEMORY-DESIGN.md:29-40` describes activity capture and nightly consolidation target behavior, but no activity-layer writer or nightly consolidation implementation was found. Current perception is rendered as ephemeral turn context.
- `packages/core/src/memory/tidy-report.ts:165-169` says an entry without disclosure “can never fire the index,” but current retrieval indexes/searches content and search terms without a disclosure hard gate. Treat this as wording drift, not a runtime constraint.
- Target-state statements in `docs/MEMORY-DESIGN.md:117-151` and ADR 0009 are design decisions only. Live behavior is the code path documented above.
- No external Hindsight API/version verification was performed in this artifact. Do not select an integration version or endpoint contract from this file alone.
- `jbcontext status` confirmed that the repository index matched HEAD `a28c9c0cfb2f`; research then used one broad `jbcontext` query followed by direct file reads and exact `rg` searches for every material conclusion above.
