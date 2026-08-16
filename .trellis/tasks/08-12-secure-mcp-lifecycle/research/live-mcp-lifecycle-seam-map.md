# Research: Live MCP Lifecycle Seam Map

- Query: live-code seam map for the Secure MCP Lifecycle slice (desired-state CRUD/test/reconnect + runtime generations + Home management)
- Scope: mixed (internal code map; frozen contracts cited, not reopened)
- Date: 2026-08-16
- Frozen authority: `.trellis/tasks/08-10-skills-mcp-productization/info.md` §3 (three state planes, candidate publication, run snapshot + lease, drain/close), `.trellis/tasks/08-12-secure-mcp-lifecycle/prd.md`, `.trellis/spec/backend/secret-catalog.md`, `.trellis/spec/backend/mcp-tool-schema-compatibility.md`, `.trellis/spec/backend/permission-authorization.md`. Nothing below reopens them.

All paths are relative to repo root `H:\TakiAgent-worktrees\t4`. Every `file:line` was read in this session unless marked UNVERIFIED.

---

## 1. Current MCP runtime (`packages/core/src/mcp/**`)

### Files Found

| File Path | Description |
|---|---|
| `packages/core/src/mcp/mcp-config.ts` | zod schemas for stdio/http server config; file loader; strict body parse |
| `packages/core/src/mcp/mcp-connect.ts` | THE sanctioned `@ai-sdk/mcp` import site; transport construction |
| `packages/core/src/mcp/mcp-manager.ts` | boot-only connect loop; discover/prepare/wrap; per-turn governance wrap; describe/close |
| `packages/core/src/mcp/mcp-schema-compat.ts` | definition preparation (per spec `mcp-tool-schema-compatibility.md`) |
| `packages/core/src/mcp/legacy-mcp-deny.ts` | read-only `mcp-approvals.json` deny adapter |
| `packages/core/src/mcp/index.md` | layer invariants: only `mcp/` may import `@ai-sdk/mcp`; no `node:child_process` |

### What is boot-only today

- `mcp-manager.ts:52-74` — `createMcpManager(deps)` awaits `Promise.allSettled(deps.entries.map(discover))` ONCE at construction. There is no per-server handle, no reconnect, no candidate concept, no generation. A failing server is skipped with a warn (line 68); the survivors merge into one flat `tools`/`refs` pair (lines 71-73).
- `mcp-manager.ts:56-59` — manager state is four closed-over locals: `clients: McpClient[]`, `tools: ToolSet`, `refs: Map<string, McpToolRef>`, `collisions: Set<string>`. The slice must replace this with per-server generation records (candidate/active/draining + lease counts) while keeping the same public shape (`tools(interactive)`, `describe`, `close`).
- `mcp-manager.ts:26-33` — current `McpManager` interface: `tools(interactive?)`, `describe(toolKey)`, `close()`. `close` is idempotent via `closed` flag (lines 80-84).
- `main.ts:197-201` — boot wiring: `await createMcpManager({ entries: loadMcpConfig(...), logger, resolveSecret: (ref) => secretCatalog.resolve(ref), governance: {...} })`. The manager is created before the WS server starts and never touched again until shutdown (`main.ts:411`).
- `main.ts:36-38` — `loadMcpConfig` / `createLegacyMcpDenyReader` / `createMcpManager` imports; entries come from `<dataDir>/mcp-servers.json` (`main.ts:198`).

### Discover / secret resolution / close path (reuse as the candidate body)

- `mcp-manager.ts:147-166` — `discover(entry, context)` is exactly the frozen candidate preparation body minus deadline/pagination/selected-tool filter:
  - `:149-151` — `secret-ref:` resolution happens ONLY here, just before connect/spawn, via injected `resolveSecret` (`deps.resolveSecret`, declared at `:40`). Never into config/logs/cached state.
  - `:152` — `context.connect(resolvedEntry)` (test-overridable via `deps.connect`, `:38`).
  - `:154` — `client.listTools()` called ONCE — see §7 pagination risk.
  - `:155-158` — `prepareMcpToolDefinitions` + per-tool skip warnings.
  - `:160` — `client.toolsFromDefinitions(prepared.definitions)` builds closures bound to that client.
  - `:162-165` — listing failure closes the client (no zombie transport) then rethrows. This is the "close candidate exactly once" precedent.
- `packages/core/src/secrets/secret-ref.ts:35-56` — `resolveMcpConfigSecrets` throws with the OPAQUE ref only when unresolvable (`:52`); the caller fails that one server. Refs are derived at `:17-23` (`mcp.<server>.env.<NAME>` / `mcp.<server>.header.<NAME>`), marker parsed at `:26-28`.
- `mcp-connect.ts:19-32` — `defaultConnect` builds stdio (`Experimental_StdioMCPTransport`, shell:false) or http transport. `McpConnect` type at `:13` is the test seam (in-memory transports).

### Governance wrapper (must survive per-generation re-publication)

- `mcp-manager.ts:78` — `tools(interactive)` returns `wrapForTurn(...)` when governance is present: fresh wrappers over the same cached raw closures each turn.
- `mcp-manager.ts:95-113` — `wrapForTurn` maps every ToolSet key through `wrapGovernedTool` with `mcpBinding` (`:115-125`: `capabilityId: "mcp.tool.call"`, `ownerHostId`, subject `{subjectId, subjectRevision}`, `cellKey: "mcp-tool-call"`, `denyConstraints` from legacy deny) and `mcpPresentation` (`:127-139`).
- `packages/core/src/governance/governed-tool.ts:33-82` — `wrapGovernedTool`: authorize at execute time (`:52`), Approval request/revalidate flow (`:56-77`). The slice's generation lease must wrap the SAME execute boundary (lease acquire → authorize → SDK call → release in `finally`), per info.md §3.3.
- Identity helpers to preserve verbatim: `stableSubject` (`mcp-manager.ts:200-202`, sha256 of `serverKey\0toolName`), `publicFingerprint` (`:204-206`, `cfg.` + sha256 of `mcpPublicConfig`), `sanitize` (`:235-237`), `wrapExecute` error envelope (`:210-223`, `{ok:false, code, message}`), `errorCode` (`:227-233`).
- Collision handling today: `mergeServerTools` (`:180-198`) removes a colliding key from the published ToolSet with a warn. Desired-state CRUD must instead REJECT the collision at candidate validation with a structured diagnostic (risk §7.3).

### Config loading / legacy inputs

- `mcp-config.ts:13-29` — `StdioServerConfigSchema` (`command/args/env/cwd`), `HttpServerConfigSchema` (`url/headers`), union `McpServerConfigSchema`. `McpServerEntry {key, config}` at `:33-36`. `mcpPublicConfig` (secret-free fingerprint input) at `:39-42`.
- `mcp-config.ts:53-68` — missing file ⇒ `[]`; unreadable/malformed ⇒ warn + `[]` (never fatal). `parseMcpServers` (`:71-80`) strict parse shared with the secret migration.
- `mcp-config.ts` header comment: config is operator-owned, NEVER agent-reachable.
- `packages/core/src/secrets/mcp-secret-migration.ts:33-79` — boot migration ordering owner: health check (`:38-43`), plan with collision detection (`:57-62`, `:108-132`), copy+verify (`:64-66`, `:82-98`), then atomic source rewrite (`:69-75`). Re-runs are no-ops (`:121`). Wired at `main.ts:190`.

---

## 2. Desired-state persistence

### Option A — config store (`config` table, migration 013): DOES NOT FIT

- `.trellis/spec/backend/config-store.md:24-32` — table is `key TEXT PRIMARY KEY, value TEXT` where value is "JSON text encoding exactly one primitive: `string | number | boolean`".
- `packages/core/src/db/config-repo.ts:31-43` — a composite value THROWS at the DB boundary ("config row ... is not a JSON primitive"). A desired MCP server row is a composite record (transport config object, selected tools array, secret refs, hostId, enabled, configRevision) — it cannot be stored without violating the spec.
- The knob registry is a closed env-knob vocabulary with `env > stored > default` precedence and apply classes (`config-store.md:74-88`) — the wrong model for resource rows. Frozen contract (parent info.md §3.1) explicitly says "Core SQLite stores desired sanitized MCP metadata" as its own plane.

### Option B — new SQLite table (migration 017): FITS (recommended)

- Migrations live in `packages/core/src/db/migrations/`; the ordered registry is `index-list.ts:24-41` — currently `001`..`016`; append the new module and one list row. Re-verify this list immediately before implementation (parent info.md §7: another child may consume `017` first; never reserve numbers in prose).
- Runner: `packages/core/src/db/migration-runner.ts:11-42` — version-tracked, one transaction per migration, idempotent (skips `version <= current`), fatal-fast on failure.
- Migration shape exemplar: `014-governance-policy.ts:8-32` — `STRICT` tables, `CHECK` constraints on enums/positives, seeded singleton row. Follow the same discipline for an `mcp_server` table (stable server id PK, owning hostId, transport/public config JSON, enabled, selected tools JSON, secret field refs, `config_revision` positive int, `updated_at`).
- Repo pattern to mirror: `packages/core/src/governance/governance-policy-repo.ts` — optimistic revision inside one synchronous transaction:
  - `:24-31` — `PolicyConflictError` carrying `currentPolicyGeneration`.
  - `:51-78` — prepared statements, `mutate({expected, change})` wrapper.
  - `:101-102` — `advance` / `setRegistry` increment statements (material change increments exactly once).
  - This is the exact pattern `configRevision` should mirror: compare expected revision → write → increment in one transaction; conflict surfaces current revision in the error data.
- `mcp-servers.json` stays as a legacy/seed input only: today it is the plaintext secret carrier that `mcp-secret-migration.ts` rewrites in place at boot (`main.ts:190`). Boot import ordering matters — see risk §7.5.

---

## 3. Operator API surface (Core)

### Method-registry conventions

- `packages/core/src/server/method-registry.ts:31-39` — `MethodDefinition { method, roles: Role[], paramsSchema: ZodType, handler(params, ctx), onInvalidParams? }`. Adding a method family is `registry.register(...)` calls, never a dispatch switch (`:60-78`).
- `:91-94` — role check: `roles: ["operator"]` is the gate for every config/permission/secret method; the agent has no path to them.
- `:24-29` — `MethodContext { notify, connection, close, onClose }`: `notify` is the push channel for `*.changed`-style notifications; `onClose` is subscription teardown (used by `config.subscribe`, per config-store.md:85).

### CRUD + revision-conflict exemplar (permission methods)

- `packages/core/src/server/methods/permission-methods.ts:31-36` — `registerPermissionMethods` registers levelGet/levelSet/cellsGet/cellSet.
- `:42-52` — `levelSet` handler passes `expectedPolicyGeneration` into the service and maps errors in `runMutation`.
- `:81-101` — `runMutation`: `PolicyConflictError` ⇒ `appException(POLICY_CONFLICT, msg, { currentPolicyGeneration })`; `GovernanceMutationError` ⇒ `GOVERNANCE_REFUSED` with machine `reason`. MCP `mcp.*` methods should produce the same shape with `currentConfigRevision`.
- `:70-79` — `changedNotifier` suppresses echo of the caller's own expected generation — the pattern for an `mcp.changed` push.
- Service side: `governance-policy-service.ts:36-52` (interface incl. `setLevel(level, expectedPolicyGeneration)`), repo transaction at `governance-policy-repo.ts:55-78`.

### Sensitive-command-path exemplar (secret methods — the model for MCP secret-field handling)

- `packages/core/src/server/methods/secret-methods.ts:38-98` — operator-only `secret.set/clear/presence/list`; every result is structurally value-free; `guarded()` (`:83-98`) converts catalog errors to bounded `SECRET_REFUSED` BEFORE the registry's verbatim `error.message`/zod-issues echo points (`method-registry.ts:98-103`). Any MCP method that can fail inside secret resolution needs the same sanitization boundary.
- Shared schema conventions: `packages/shared/src/secret-catalog-schema.ts:11-16` (`SECRET_METHODS` const), `:20-24` (`SecretRefSchema` bounded dot-segment regex — reuse for `secret-ref` fields in MCP desired state), strictObjects with no value-carrying result fields. `PERMISSION_METHODS` at `permission-level-schema.ts:11`; `CONFIG_METHODS` at `config-schema.ts:9`. New `MCP_METHODS` + schemas follow this layout and must be exported from `packages/shared/src/index.ts` (secret exports at `:317-321` show the pattern). No Rust mirror for operator-only families (secret schema header states this explicitly).
- Config methods (`config.list/set/subscribe/changed`) live in `packages/core/src/server/methods/config-methods.ts` (registered at `main.ts:379`); their exact internals were not read line-by-line — see UNVERIFIED.

### Where to register

- `main.ts:191` (`registerSecretMethods`) and `main.ts:379` (`registerConfigMethods`) show registration order; MCP methods need the new manager + repo handles, so register after the manager is constructed (`main.ts:197-201`). Note the current manager construction is `await`ed at module top level — making MCP connect non-fatal/async to boot latency is a decision the implement agent owns within the frozen contracts.

---

## 4. Desktop / Home surface

### Page registration (one row = new page)

- `apps/desktop/src/windows/home/pages.ts:27-33` — `HOME_PAGES` ordered registry rows `{id, label, icon, component}` (labels are Chinese UI strings); `:36` `PageId` closed union; `:40-42` `isPageId` runtime gate for boot-param/Tauri-event ids. Add the MCP page as one row plus an icon in `apps/desktop/src/lib/icons/`.
- `apps/desktop/src/windows/home/home-shell.tsx:53-79` — window root renders the left menu from the registry and `<CurrentPage />` inside `HomeClientContext.Provider`; non-chat pages get `<ConnectionStatusBanner status={connection.status} />` (`:71`). The MCP page inherits reconnecting-state UX for free by living here.
- `apps/desktop/src/windows/home/use-home-connection.ts:20-22` — the settings-family pages share ONE operator connection (`useOperatorConnection` with device `taki-home`); the MCP page must use `useHomeClient()` from `home-client-context.ts` like settings/operations do.
- Cross-window navigation: `apps/desktop/src/lib/open-home-window.ts` + `use-home-navigate-event.ts` (page id travels as a query param gated by `isPageId`).

### Typed client surface (where MCP methods land client-side)

- `apps/desktop/src/lib/ws-client.ts:70-135` — `WsClient` interface: one typed method per Core method plus push-sink registrars (`onConfigChanged` `:130`, `onApproval` `:122`). Composition at `:174-224`: `createRoutes()` + `installRoutes` (inbound) + `requestMethods` (outbound) + `...methods` spread (`:214`).
- `apps/desktop/src/lib/ws-client-methods.ts:109-158` — `requestMethods`: EVERY result parsed through a `@taki/shared` schema at the boundary (e.g. `:135-137` configList/configSet). Add `mcp*` methods here with the same one-line-parse discipline; group as a factory like `permissionMethods` (`:61-72`).
- `apps/desktop/src/lib/ws-client-routes.ts:93-138` — inbound notification routing; `addConfigChangedHandler` (`:73-76`) + `CONFIG_METHODS.changed` install (`:127-136`) is the exact pattern for an `mcp.changed` push. Handlers cleared on transport retire (`:84-90`).

### Loading / empty / partial-failure state conventions (reuse, do not invent)

- `apps/desktop/src/windows/home/pages/settings/permission-state.ts:21-24` — `PermissionViewState = loading (with previous) | ready (data + feedback + pending) | failure (read|validation, with previous)`. Feedback union at `:15-19`: `saved | conflict | refused(reason) | error`. Conflict ⇒ refetch Core truth (`:109-119` maps `POLICY_CONFLICT` to a "changed elsewhere; refreshed" message — mirror for `configRevision` conflicts).
- `apps/desktop/src/windows/home/pages/settings/use-permissions.ts:29-63` — React seam conventions: state only in component memory (never localStorage/Zustand persistence, per permission-authorization.md:214-219), token-guarded transitions against stale generations (`permission-state.ts:35` `if (state.token !== token) return state`), one mutation in flight (`pending: string | null`), controller split (`permission-controller.ts`, framework-free) for node-testability, refetch per new authenticated client generation (`use-permissions.ts:46-50`).
- Operations page (`apps/desktop/src/windows/home/pages/operations/`) is the second reference for destructive-action confirm + counters (`mediaClear` confirm convention visible at `ws-client.ts:104`).
- CLI precedent for secret-family commands over stdin: `apps/cli/src/main.ts:88-92` + `secret-commands.ts` (value never enters argv) — relevant if MCP secret-field set/clear gets a CLI path in this slice.

---

## 5. Runtime generation machinery (how to layer candidate/active/draining + leases)

### Existing generation precedents to copy semantics from

- `packages/core/src/hosts/host-catalog.ts:38-83` — `HostCatalogStore.publish/retire`: rejects `stale_generation` when `catalogGeneration <= current` for the same connection generation (`:61-67`), atomically replaces (`:68`), `retire(hostId, connectionGeneration)` deletes only the matching generation (`:71-74`). This is the in-memory atomic-replacement + monotonic-generation precedent for the MCP runtime manager (process-local counters only — info.md §2.2/§3.4: never persisted as truth).
- `packages/core/src/hosts/host-generation-retirement.ts:16-24` — disconnect retires exactly one generation's pending work (fail-closed, scoped). The MCP drain-on-shutdown must be similarly scoped per server generation, not a global flush.

### Where per-turn tool assembly happens (the publication point future Runs read)

- `main.ts:309-312` — `turnTools: (turn) => ({ ...capabilityTools({...}), ...mcpManager.tools({ connection: turn.connection, signal: turn.signal }) })`. Every turn calls `mcpManager.tools(...)` fresh; if the manager publishes a new generation under its lock (info.md §3.2 step 5), the NEXT turn's call here is what picks it up. An existing turn keeps the ToolSet object it already captured — that is the immutable Run snapshot seam (info.md §3.3).
- `packages/core/src/agents/chat-agent.ts:249-258` — `assembleTurnTools`: `const extra = turn?.connection && deps.turnTools ? deps.turnTools(turn) : ...` (line 256). Unattended turns (no connection) fall back to `extraTools` — MCP tools are currently only in `turnTools`, so ambient turns get none; preserve or intentionally decide.
- `packages/core/src/capabilities/capability-tools.ts:34-59` — factory pattern for per-call/per-turn tool construction with injected interactive context; the MCP manager's `tools(interactive)` already matches this shape (`mcp-manager.ts:78`).

### Lease + drain insertion point

- The model-facing closure chain today: raw SDK closure → `wrapExecute` (`mcp-manager.ts:210-223`) → `wrapGovernedTool` (`governed-tool.ts:33-82`). The lease belongs OUTSIDE the raw closure and around the governed execute: acquire generation lease → revalidate (governance authorize already revalidates policy at `governed-tool.ts:52/67`) → raw call → release in `finally`. If the generation retired pre-lease: structured stale-generation `{ok:false}` result (same envelope as `wrapExecute`), never redirect to the replacement (info.md §3.3).
- Shutdown today: `main.ts:408-415` — `server.close().then(() => mcpManager.close(); db.close(); process.exit(0))`. The manager's `close()` must grow: stop publication → cancel candidates → bounded drain → force-close remaining, exactly-once per client (today's `closed` flag at `mcp-manager.ts:80-84` is the exactly-once precedent).
- Core host identity for `ownerHostId`: `main.ts:90` — `loadOrCreateHostIdentity(join(serverConfig.dataDir, "host-identity.json"))`; passed into governance at `main.ts:200`.

---

## 6. Testing seams

### Focused unit/integration (vitest, packages/core)

- `packages/core/src/mcp/mcp-manager.test.ts:47-83` — `InMemoryTransport` duck-typed MCP transport (initialize/tools/list/tools/call handlers, `closedCount` for exactly-once-close assertions). `:115-121` `memConnect` maps entries to transports via `deps.connect` override (`mcp-connect.ts:13`).
- Key existing scenarios to extend for generations/leases:
  - `:304-320` one failing server skips, others stay live (failure isolation AC).
  - `:322-347` `secret-ref:` JIT resolution; unresolvable ref skips only that server; sentinel never logged (locked-catalog interaction proof).
  - `:349-356` `close` idempotent (`closedCount === 1`).
  - `:358-450` schema-compat isolation + provider-boundary capture (`captureProviderTools` `:123-142` with fake-fetch OpenAI-compatible provider).
  - `:452-463` real stdio child end-to-end via `packages/core/src/testing/mcp-fixture.mjs`.
- Governance in tests: `:37-41` `policy()` opens `:memory:` db with the full `MIGRATIONS` list and wraps the real repo/service; `expectedPolicyGeneration: 1` usage at `:218-219`. `createCaptureLogger` from `packages/core/src/testing/capture-logger.ts` backs log-sentinel probes (`:346`).
- Repo/migration tests live beside their subjects (`014-governance-policy` test conventions: table creation, idempotent set, STRICT enforcement — see config-store.md §6 test list for the 013 exemplar).

### Real-process e2e (vitest, e2e/)

- `e2e/src/fixture/with-stack.ts:114-121` — `withStack(options, fn)` boots core (`node src/main.ts`) + optional Rust node with auto pairing; always tears down.
- Stack helpers for the lifecycle scenario: `restartCore(envOverrides?)` (`:87`, impl `:224-238` — same data dir/port, operator socket retired so the next `operator()` re-pairs), `killCore()` (`:83`), `waitForCoreLog(pred)` (`:78`), `operator()` memoized paired RpcSocket (`:89`), `setPermissionLevel` (`:93`).
- Seeding: `seedMcpServers` (`:51-52`, write at `:187-189` pre-boot), `secretMasterKey` hermetic credentials dir (`:49-50`, `:190-197`). These are exactly the hooks a crash/reconciliation scenario needs (seed desired state → kill -9 style `killCore` → `restartCore` → assert reconciliation, no fake runtime truth).
- Scenario exemplar: `e2e/src/secret-catalog.e2e.test.ts:41-84` — set → restartCore → presence survives; key-source removal → locked fail-closed refusal `{code: "SECRET_REFUSED", reason: "store-locked"}` with byte-identical catalog; sentinel-absence probes over responses, logs, disk. `:86-116` — boot migration scenario using `seedMcpServers` + `waitForCoreLog("mcp plaintext secrets migrated to catalog")`. Copy this structure for: add/edit without restart, candidate failure keeps last-good, in-flight call survives replacement, disable/remove drains, crash reconciliation.
- JSON-RPC driver helpers: `resultOf`/`errorOf` wrappers (`secret-catalog.e2e.test.ts:27-38`) using `@taki/shared` response schemas; operator drivers in `e2e/src/fixture/operator-drivers.ts`.

---

## 7. Risk register

1. **Crash reconciliation (desired vs observed).** Runtime generations/leases are never persisted (info.md §3.1/§3.4). Restart must rebuild from the desired table only; a previously observed `connected` state or generation id must not be restored. The e2e proof shape already exists (`restartCore` + log probes). Related: interrupted side effects settle `outcome_unknown`, never replayed.
2. **Locked secret catalog must not brick MCP boot.** `secret-ref.ts:52` throws opaque-ref errors; `mcp-manager.ts` skips only the affected server. Reconciliation at boot and every candidate publication must keep that containment (a locked store ⇒ affected servers fail closed with sanitized diagnostics, unrelated servers live; secret-catalog.md §3 "locked semantics"). Presence reads under lock report `present:false/unknown`, which must not be interpreted as "absent" (secret-catalog-schema.ts:80 header note).
3. **Collision rejection UX.** Today `mergeServerTools` (`mcp-manager.ts:180-198`) silently drops colliding keys from the published set. Desired-state CRUD must reject at candidate time with a structured, operator-actionable diagnostic naming both identities (and the secret-migration's own sanitized-ref collision precedent `mcp-secret-migration.ts:58-61` skips migration entirely — the CRUD path must be stricter than both).
4. **SDK pagination absence.** `@ai-sdk/mcp@2.0.10` (`packages/core/node_modules/@ai-sdk/mcp/package.json:3`): `listTools` (`dist/index.js:2386-2396`) issues ONE `tools/list` request and returns; `nextCursor` exists in the result schema (`dist/index.js:63`) but the SDK does NOT loop pages. Candidate preparation must implement the cursor loop itself under one bounded deadline (info.md §3.2 step 3). Also: no `tools/list_changed` handling found in the dist (consistent with the PRD's out-of-scope stance).
5. **Boot-ordering interactions in `main.ts`.** Current order: db/bootstrap (`:88`) → secret catalog (`:184-187`) → plaintext migration rewriting `mcp-servers.json` (`:190`) → MCP manager (`:197-201`) → WS server (`:400`). If desired state moves to SQLite with `mcp-servers.json` as import/seed, the migration's in-place rewrite of that file must not fight the import (idempotent re-runs are no-ops, `mcp-secret-migration.ts:121`), and `main.ts` is a declared merge hotspot (info.md §7) — check `main...HEAD` before editing.
6. **`configRevision` conflict semantics.** Must mirror `expectedPolicyGeneration` exactly: compare inside one transaction, `POLICY_CONFLICT`-style app error carrying current revision (`permission-methods.ts:93-95`, `governance-policy-repo.ts:24-31`), Home refetches and never replays after timeout (`permission-authorization.md:269`). Two Home windows editing concurrently is the base case to test.
7. **Shutdown drain budget.** `main.ts:408-415` currently closes immediately after `server.close()`. The new manager must stop publication, cancel candidates, drain under one global budget, then force-close — before `db.close()`/`process.exit(0)`. Keep `close()` idempotent.
8. **One bad server must not disable unrelated tools** (PRD AC). Already true at boot (`mcp-manager.ts:66-69`); candidate publication must preserve it per-server, including when candidate failure leaves last-good serving (info.md §3.2 step 4).
9. **Unattended turns.** MCP tools ride `turnTools` only (`main.ts:309-312`, `chat-agent.ts:256`), so ambient/unattended turns see no MCP tools today; any change here is a product decision inside frozen contracts — flag, don't drift.

---

## Caveats / Not Found (UNVERIFIED)

- `packages/core/src/hosts/host-identity.ts` internals — not read; behavior cited only via `main.ts:90` and secret-catalog.md §2 (atomic replacement, fail-boot on malformed).
- `packages/core/src/server/methods/config-methods.ts` internals — documented from `.trellis/spec/backend/config-store.md` (which is explicit and current, citing commit-tested behavior), not read line-by-line.
- `packages/core/src/server/methods/host-catalog-publish.ts` internals — registered at `main.ts:348`; not read. Relevant only as a naming precedent for `host.catalogPublish`, not required for this slice.
- `packages/core/src/secrets/secret-catalog-service.ts` internals (resolve/health/set/verifyEntries signatures) — cited from `main.ts:184-199`, `mcp-secret-migration.ts:17-21`, and spec; the service file itself not read. The implement agent should read it before depending on exact return types.
- Pagination claim verified against `packages/core/node_modules/@ai-sdk/mcp@2.0.10` dist only (single `listTools` request, `nextCursor` present, no loop, no `list_changed` hits in one grep). If the lockfile advances the SDK version, re-verify.
- No existing `mcp.*` operator method family, Home MCP page, or SQLite desired-state table exists anywhere — searches of `packages/core/src`, `packages/shared/src`, and `apps/desktop/src` found none (this slice creates all three from scratch).
