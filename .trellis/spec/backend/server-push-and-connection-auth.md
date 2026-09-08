# Server-Push Channels & Connection Auth (established #16)

Producer-backed fan-out, operator observation and authenticated connection lifetimes.

## Server→client push channel (the timeline/avatar fan-out pattern)

When the Core must push events to a subscribed client mid-turn (timeline entries, avatar commands), clone the established fan-out — do NOT invent a new mechanism:

- `server/<x>-subscriptions.ts` — a `Map<characterId, Map<Connection, sink>>` with `subscribe / unsubscribe / publish / count`; `publish(payload)` fans to every sink registered for `payload.characterId`.
- `server/methods/<x>-subscribe.ts` — role-gated (`["operator"]`), calls `subscriptions.subscribe(characterId, connection, (p) => ctx.notify(METHOD, p))` and `ctx.onClose(() => unsubscribe(...))` for auto-cleanup on socket close.
- The producer (conversation store's `onAppend`, an avatar tool's `execute`) calls `subscriptions.publish(...)`. Fan-out is synchronous → the event reaches the client the instant it's produced, even mid-turn.
- Reference impls: `server/timeline-subscriptions.ts` + `server/methods/timeline-subscribe.ts`; `avatar/avatar-subscriptions.ts` + `server/methods/avatar-subscribe.ts`.
- A snapshot needs actual producers before it can promise change notifications. `perception.card` remains a read;
  accepted activity/scheduling/pause facts now publish opt-in `perception.changed` invalidations. The extension
  channel similarly observes real MCP/Skill/Host lifecycle commits. `media.usage` remains demand-driven; no UI
  polling or empty subscription is introduced for resources without change coverage.

### Per-generation reconnect restoration (D59)

- Subscription membership is connection-scoped and is deliberately removed by `ctx.onClose`. A replacement browser
  socket therefore MUST authenticate and issue fresh subscriptions; Core never transfers membership to a new
  connection or treats a prior device identity as an active sink.
- Restoration is client-owned and observed before the surface claims healthy: Pet installs its guarded handler,
  reports the live scene, then awaits one `avatar.subscribe`; Chat installs append/remove handlers, awaits one
  `timeline.subscribe`, then reconciles history. A failure closes/replaces that generation rather than leaving a
  connected UI with a dead channel.
- `config.subscribe` is idempotent per connection. The desktop `WsClient` memoizes the request and fans one
  `config.changed` notification to multiple local consumers, so timing sync and the Settings page cannot create
  duplicate Core memberships. Only an accepted setup is retained indefinitely: a rejected/invalid setup may be
  deliberately retried on the same client. Recovery reconciles the existing timing owner once, including changes
  missed during the setup gap; no new timing authority or recurring retry is introduced.
- Producers remain fire-and-forget with respect to subscriber count. Zero subscribers is valid Core behavior; window
  recovery and honest connection status, not a fabricated tool failure, repair the owner-reported long-idle avatar
  symptom.
- Never replay operator mutations during restoration. Only subscriptions, truthful reports, and idempotent reads may
  run automatically. See `../frontend/operator-connection-recovery.md` for the desktop generation contract.

**No Rust serde mirror for operator-only channels.** Invariant 3 mirrors only shapes the Rust Shell (a *node*) actually handles — connect/capability/approval. `chat.*`, `timeline.*`, `avatar.*` are operator↔core direct (the Pet UI webview + CLI open their own loopback WS as operators); the Rust Shell never sees these frames, so they live in `@taki/shared` zod only. Test their round-trips in a standalone `<x>-schema.test.ts`, NOT `protocol-fixtures.test.ts` (that sweep asserts a Rust serde struct per prefix — adding an unmirrored prefix reds the cargo side).

## Connection auth ≠ Core policy ≠ Host final enforcement

Do not conflate them:

| Layer | Question | Where | Keyed on |
|------|----------|-------|----------|
| **Connection auth** (`connect.ts`) | may this *device* attach, and as what role? | the one pre-auth method | token / pairing / loopback-auto-trust; role locked at issuance |
| **Core governance authority** | what is the profile-wide posture for this canonical action at generation N? | Core evaluator + SQLite | canonical identity, descriptor/cell, Level/override, `policyGeneration` |
| **Host final enforcement** | may this exact Host-owned input execute now? | owning Execution Host | sealed Host/connection/catalog generations, trusted local classification, Core projection, stricter local/managed/hard constraints |

Authentication and catalog presence never grant permission. Conversely, a Core `auto` posture does not compel a Host
to execute when its local availability or stricter floor refuses. See `permission-authorization.md` for the complete
projection/evidence contract.

### Loopback auto-trust (P3) — the local-operator connection rule

An operator on the trusted machine boundary needs no pairing ceremony (localhost is the security boundary; interactive pairing is a remote-device pattern — see D23). The rule, in `connect.ts` order:

1. token branch (verify → authenticate, or fail-closed `AUTH_FAILED` + socket close),
2. pairingCode branch,
3. **auto-trust**: fires ONLY when `trustLoopbackOperator` (config, default on) AND `role === "operator"` AND `isLoopback(remoteAddress)` — then issue a token (the SAME `issueToken` pairing uses; reconnect works even if the flag later flips) + authenticate,
4. else `beginPairing` / `PAIRING_REQUIRED`.

Non-negotiable safety properties (all enforced + tested; a change here is a security review):

- **Ordering is fail-closed**: a wrong token fails in branch 1 and NEVER reaches auto-trust, even on loopback+flag-on.
- **Operators only**: nodes carry capabilities and final execution boundaries, so they must still pair. Auto-trusting a
  node would let an unauthenticated process publish Host identity/catalog/classifier metadata and is a real escalation.
- **`isLoopback(undefined) === false`**: an unknown/absent peer address falls to pairing (fail-closed). Address comes from the WS upgrade transport peer (`request.socket.remoteAddress`), never a spoofable header; exact-set membership {127.0.0.1, ::1, ::ffff:127.0.0.1}, not a loose prefix/CIDR that could over-match.
- **The flag is an auth kill-switch → parse it fail-closed**: default on; disabling fully restores mandatory pairing for ALL peers (the VPS/public-Core posture). Accept only strict `true/1/false/0` (case-insensitive); garbage errors at boot, never silently means on.
- **Audit every mint**: auto-trust persists a credential → log it (deviceId/deviceName/remoteAddress; never the token), same as pairing logs its code.
- Operator capabilities are schema-forced empty (`connect-schema.ts`), parsed before the handler → an auto-trusted operator can't smuggle capabilities.

Reference: `server/methods/connect.ts`, `devices/device-registry.ts` (`issueToken`/`trustDevice`), hardened by the fable5 security review (2026-07-14). Residual boundary notes (multi-user host, deviceId clobber) → deferred D25.

## Scenario: Core shutdown drains accepted connections before storage

### 1. Scope / Trigger

Applies to `WsServer.close()` and Core process shutdown. Connection callbacks can cancel Runs, retire Host
generations and unsubscribe observers; they may still need SQLite after the listening port has closed.

### 2. Signatures

- `WsServer.close(): Promise<void>` resolves after both the owned listener and all accepted sockets close.
- `MethodContext.onClose(callback: () => void)` callbacks and `ConnectionRegistry.remove(connection)` run
  before that promise resolves. This does not turn synchronous callbacks into background work.
- `main.ts` invokes the existing SIGINT/SIGTERM shutdown handler once; no public shutdown RPC is added.

### 3. Contracts

- Preserve admission sealing, recovery/scheduler stop, cancellation and bounded turn draining before closing
  the server. Close Skill/MCP resources and SQLite only after accepted connection cleanup finishes.
- Register each accepted socket's close waiter before terminating it. The installed `ws` implementation's
  internally created HTTP server can emit close before its upgraded sockets finish; its callback alone is
  insufficient. Socket errors remain logged and do not substitute for socket closure.
- After resource cleanup, set `process.exitCode = 0` and let Node retire remaining native I/O naturally.
  `process.exit(0)` after fetch can trigger a Windows Node/libuv async-handle assertion and truncate logs.
- Process tests may deliver SIGTERM through a test-only `--import` IPC preload on Windows. The preload must
  disconnect its own IPC channel so the test itself does not keep Core alive. Production has no such hook.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Authenticated peers remain attached at shutdown | All registered cleanup completes before SQLite closes. |
| A peer starts closing concurrently | Same cleanup ordering; no late `database is not open` callback. |
| Provider HTTP requests have failed and settled | Successful cleanup exits 0 without forced termination or native assertion. |
| A lifecycle check times out | Fail and clean up the owned process; never report a force-killed process as graceful. |

### 5. Good/Base/Bad Cases

- Good: wait for listener plus accepted socket closure, release storage, and allow natural process exit.
- Base: no connected peers; listener closure still completes the same shutdown chain.
- Bad: close SQLite as soon as the HTTP listener closes, or hide pending callbacks by forcing process exit.

### 6. Tests Required

- `packages/core/src/server/ws-server.test.ts`: keep two authenticated peers open; immediately after close
  resolves, the connection registry is empty and both removal callbacks have run exactly once.
- `e2e/src/core-shutdown.e2e.test.ts`: boot actual strip-only Core with isolated storage and a local rejecting
  HTTP provider, settle two Chat failures, then stop with an open or concurrently closing peer. Assert exit 0,
  one shutdown, no native assertion, bounded cleanup and no paid provider or real data access.

### 7. Wrong vs Correct

```ts
// Wrong: an HTTP listener can close before the accepted WS connection callbacks finish.
await new Promise<void>((resolve) => wss.close(() => resolve()));
db.close();
process.exit(0);

// Correct: the server primitive owns both listener and accepted-connection cleanup.
await server.close();
await closeRemainingResources();
db.close();
process.exitCode = 0;
```

## Scenario: Operator resource invalidation

### 1. Scope / Trigger

Home's visible Perception, MCP/Skills lists and extension strip must learn actual asynchronous or cross-operator
changes. Notifications indicate that a projection needs reconciliation; existing read methods remain authoritative.
They do not execute operations, carry private snapshots, or grant permission.

### 2. Signatures

```ts
perception.subscribe({}) -> { status: "ok" }
perception.changed      -> { revision: number }
extension.subscribe({}) -> { status: "ok" }
extension.changed       -> { revision: number, targets: ("mcp" | "skills" | "extension-status")[] }
```

The strict contracts live in Shared `perception-schema.ts` and `extension-change-schema.ts`. Revisions are
nonnegative safe integers. Extension targets are nonempty, unique and limited to the three named projections.
These operator-only frames have no Rust mirror, database migration, extra socket or environment variable.

Core owns `createPerceptionChanges(...)` / its connection-keyed subscriptions and
`createExtensionSubscriptions()`. `subscribe(connection, sink)` returns true only for a new member, so each
method registers one `ctx.onClose` cleanup. Repeated subscribe replaces the sink without duplicating membership.
Perception layer `dispose()` retires its interest/deadline owner; extension `dispose()` clears membership and any
queued target union during normal Core shutdown.

### 3. Contracts

- Authenticate and check operator role before membership. Install the sink before acknowledging setup. A rejected
  or lost acknowledgement is safe to retry idempotently; physical connection replacement needs fresh membership.
- Revisions order one process/channel's invalidations. They are neither durable replay cursors nor versions of
  the existing unversioned read responses. The browser installs its handler, acknowledges subscription, then reads.
  An invalidation during that read leaves a trailing obligation before the view can claim current coverage.
- Notifications contain only the fields above: no titles, app identity, screenshot content, package paths/IDs,
  config, credential refs/values, errors, tool arguments or output. Every observer is isolated from others and
  from the already committed operation. Zero subscribers is valid and never starts a query, test or producer.
- Perception sources are accepted/scrubbed ActivityState changes, effective seals/prunes, changed foreground or
  ambient scheduled-running flags, and successfully persisted pause transitions. Sampling cadence, dwell, privacy
  screening and retention stay under their existing owners. `current` is the latest sampled stretch; scheduled
  running does not prove a currently available Host or an in-progress capture.
- Pause persistence succeeds before its live state or notification changes. The only production mutator caller
  remains operator `perception.pauseSet`. While subscribers exist, one bounded unref'd absolute-deadline timer
  invokes the existing `pause.state(now)` read. It handles hydration/replacement/long deadlines/lazy settlement,
  never calls `resume`, writes the DB, restarts sampling or invokes a model, and retires on last close/disposal.
- MCP observes desired commits (including disabled adds and surviving partial commits), current candidate
  start/outcome/removal, active publication/withdrawal and status-changing closure. Immediate `onClosedState`
  follows `closed = true`; existing deferred `onClosed` remains transport cleanup. Closing a draining fallback
  can change tool count while the displayed phase is still connecting. Ordinary leases and private Test results
  do not notify; no independent remote MCP death/list-change detection is claimed.
- Skills observes committed operator rows, including rejected imports without catalog advancement, and coherent
  catalog publication. Ordinary reads, leases and GC are quiet. Host catalogs observe accepted `live.set` and
  actual matching `live.delete`; invalid current-candidate retirement is covered and stale old close cannot retire
  a replacement. Existing generation/authorization checks and immutable Run snapshots are unchanged.
- Extension target coalescing unions already-produced targets in one microtask; it neither drops one producer's
  target nor invents a catalog change. Install the observer before Host/Skill/MCP boot and reconciliation.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Anonymous / authenticated Node subscribe | Existing authentication/role refusal; no membership or notification. |
| Duplicate subscribe or retry after lost acknowledgement | One connection member and one close cleanup. |
| Empty/duplicate/unknown extension targets or extra private fields | Shared validation rejects the payload; Desktop does not invalidate from it. |
| One throwing sink / no sinks | Other observers and committed outcomes remain correct; no new producer work. |
| Real commit followed by fallible DTO read-back | The surviving commit still invalidates; a pre-commit refusal does not. |
| Pause write fails | Live consent and notification remain unchanged. |
| Last observer closes / shutdown / replaced deadline callback | Retire obsolete interest/timer; never lift a replacement pause. |
| Older Core returns `-32601` for subscribe | Explicit entry/manual-read fallback with automatic-refresh-unavailable feedback, never UI polling. |
| Forbidden, malformed acknowledgement, timeout or other setup failure | Retain truthful error/gap and deliberate retry; do not relabel as unsupported or authorize a fallback. |

### 5. Good/Base/Bad Cases

- Good: operator A commits a rejected Skill row; B receives only `skills`, then reads the new row without a catalog
  generation change. A later accepted publication invalidates both `skills` and `extension-status`.
- Base: no open observer; existing lifecycle and capture behavior continue with no extra read or model work.
- Bad: send a full private card to every connection, notify each tool lease, call reconnect on a list event, or
  treat the notification revision as the version of an older `mcp.list` reply.

### 6. Tests Required

- Shared schema suites reject private/extra fields and invalid revisions/targets. Core subscription/method tests
  prove roles, duplicates, exceptions, membership cleanup and bounded target union.
- Perception source/deadline tests cover accepted/sensitive/malformed samples, scheduling changes, persistence
  failure, hydrated/replaced/expired/long deadlines, lazy prior settlement and stopped-sampler expiry.
- MCP/Skill/Host tests cover partial commits, current candidates, last-good/draining closure including connecting
  fallback, rejected Skill rows, publication, accepted set/matching delete and quiet read/lease paths.
- `e2e/src/perception-refresh.e2e.test.ts` and `extension-refresh.e2e.test.ts` use actual isolated Core with separate
  operators, synthetic sources and no user accounts/data. Native UI fixtures separately prove consumption and
  interaction continuity; neither kind substitutes for the other or for personal owner inspection.

### 7. Wrong vs Correct

```ts
// Wrong: waits for deferred transport cleanup after the observable state already changed.
record.onClosed = () => invalidateStatus();
// Wrong: a rejected package may be committed without any catalog generation change.
if (catalogGenerationChanged) invalidateSkills();

// Correct: observe actual state/commit boundaries with data-free targets.
record.closed = true;
record.closePromise = closeMcpClient(record.client).finally(() => record.onClosed?.(record));
notifyExtensionChange(record.onClosedState, ["mcp"]); // deferred onClosed still owns cleanup
// At the successful Skill row commit boundary, independently from later catalog publication:
notifyExtensionChange(onChange, ["skills"]);
```
