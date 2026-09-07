# Operator Connection Recovery and Request Deadline Contract

> This contract governs the desktop operator WebSocket clients in the pet, home, and chat surfaces. The browser
> transport is disposable; Core remains the state of record. Reconnection restores connection-scoped reads and
> subscriptions, never buffered user intent.

## 1. Scope / Trigger

Use this contract when changing any of the following:

- browser WebSocket creation, authentication, retirement, or retry;
- `WsClient` request/response methods or request timeout classes;
- pet avatar, chat timeline, or config subscription restoration;
- mounted pages whose server-owned data changes while the connection stays healthy;
- connection status presentation or readiness-gated controls;
- the shared D59/D61 timing policy consumed by a desktop window.

Passive detection of an otherwise silent half-open socket is not part of this contract. D59 bounds active work and
recovers after an observed close/failure; heartbeat and sleep/resume detection remain T4 work.

## 2. Signatures

```typescript
type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "reconnecting" }
  | { kind: "connected" }
  | { kind: "pairing-required" }
  | { kind: "disconnected" }
  | { kind: "error"; code: ErrorCode | null; message: string };

interface ConnectionGenerationContext {
  generation: number;
  isCurrent(): boolean;
}

interface ConnectionGenerationController<TClient> {
  start(): void;
  snapshot(): { client: TClient | null; status: ConnectionStatus };
  subscribe(listener: (snapshot: ConnectionSnapshot<TClient>) => void): () => void;
  dispose(): void;
}

interface ReactiveReadModel {
  refresh(reason: "mount" | "focus" | "visibility" | "invalidation" | "reconnect" | "manual"): Promise<void>;
  snapshot(): {
    loading: boolean;
    refreshing: boolean;
    stale: boolean;
    error: string | null;
  };
  dispose(): void;
}

type RpcDeadlineClass = "open-auth" | "interactive" | "long" | "chat-ack";

class RpcDeadlineExceededError extends Error {
  method: string;
  timeoutMs: number;
  deadlineClass: RpcDeadlineClass;
  outcomeUnknown: boolean;
}
```

The window-owned timing policy contains these fields:

```typescript
interface TimingPolicy {
  reconnectBaseMs: number;
  reconnectCapMs: number;
  reconnectStabilityResetMs: number;
  openAuthMs: number;
  interactiveRpcMs: number;
  longRpcMs: number;
  chatAckMs: number;
  petCostumeTotalMs: number;
  rendererLoadMs: number;
  homeResultMs: number;
}
```

## 3. Contracts

### Independent lifecycle owners

- Pet, shared Home, and Chat own three independent controllers and physical sockets. Chat must not share Home's
  settings-family client, and no window assumes shared JavaScript memory.
- Every attempt creates a fresh transport and a fresh `WsClient`. A candidate client is published only after its
  `connect` handshake and required per-generation restoration complete.
- `WsTransport.send(payload): void` rejects unless the native socket is `WebSocket.OPEN`, before native `send()`.
  CLOSING/CLOSED browsers can discard a send without throwing, leaving a cleanup RPC pending until its deadline.
  The existing JSON-RPC rejection path must release that ID/deadline immediately; never buffer or replay the payload.
- `connect` uses one captured `openAuthMs` budget across both physical open and authentication. Time spent opening is
  subtracted before the handshake request starts; expiry must not send a late `connect` frame.
- A close or transient attempt failure retires that generation exactly once, publishes `reconnecting`, and schedules
  another attempt with capped exponential full jitter. The exponent resets only after the authenticated generation
  remains healthy for `reconnectStabilityResetMs`.
- `PAIRING_REQUIRED` is a terminal presentation state, not a blind retry input: the owner must wait for an explicit
  pairing action before trying again. An `AUTH_FAILED` caused by a previously stored operator token is different: the
  owner may clear that stale token once, preserve the stable device identity, retire the rejected candidate, and start
  one fresh generation without a token. If the fresh generation is still rejected, publish the terminal error and do
  not retry again. Recovery is bounded to one attempt per connected-generation lifecycle; it must never become an
  unbounded authentication loop. Disposal cancels retry/stability timers and retires the current candidate.
- Late callbacks from generation N must pass `isCurrent()` before changing UI state or the live scene after generation
  N+1 exists.

### Retirement and request deadlines

- Retirement synchronously rejects pre-open waiters, clears connection-scoped push handlers, rejects every pending
  JSON-RPC request, and settles the active D29 chat turn through its existing error path.
- Ordinary requests use `json-rpc-2.0`'s native `rpc.timeout(ms).request(...)` seam. Do not wrap a bare request in an
  outer `Promise.race`; it leaves the library pending entry alive.
- Method policy distinguishes open/auth, interactive reads/mutations, long mutations, and chat acknowledgement. A
  method not listed explicitly defaults to an interactive mutation, which is the conservative unknown-outcome class.
- A read timeout is retryable by explicit caller action. A mutation/chat-ack timeout means the outcome is unknown and
  must never be replayed automatically. One request timing out must not reject unrelated concurrent requests.
- `chat.send` acknowledgement is bounded, but the accepted stream still settles through `chat.complete`,
  `chat.error`, or D29 connection retirement. This contract does not invent stream resume or replay.

### Timing policy authority

- `@taki/shared` owns the timing key vocabulary, defaults, field mapping, and cross-field schema. Core config is the
  only persisted authority; desktop keeps one in-memory last-good policy per window owner.
- The development fallback is available before any Core connection exists. An invalid or failed `config.list`
  refresh keeps the last-good policy and emits a diagnostic; it never disables bootstrap reconnect.
- One `WsClient` fan-outs `config.changed` to multiple local handlers and memoizes `config.subscribe`, so timing sync
  and the Settings page share exactly one Core subscription request per generation.
- A relevant change triggers a serialized full `config.list` reread. In-flight operations keep the duration captured
  when they began; a new value applies to later requests/retry attempts only.
- No timing policy or connection authority is persisted to `localStorage`.

### Per-generation restoration

- Pet installs a generation-guarded avatar callback, reports `PetScene.reportSnapshot()`, then observes one
  `avatar.subscribe`. Report/subscribe failure rejects restoration, so a missing remote-command channel cannot be
  labeled connected. A committed costume report failure is tracked for recovery and retried from the live scene on a
  later generation.
- Shared Home publishes the replacement client to mounted pages. Idempotent reads naturally revalidate from client
  identity; mutations are never replayed.
- The optional Run monitor owns a framework-free, in-memory controller per mounted Home page. Rebinding increments a
  generation, removes the retired push handler, explicitly unsubscribes the retired client, rereads monitor state and
  the bounded Run page, then restores only the selected Run's durable trajectory/live cursor. Late list, trajectory,
  inspector, or push results from an older generation are ignored. Overflow marks the view stale and rereads from the
  last durable cursor; monitor data is never written to `localStorage`.
- Chat installs guarded `timeline.appended` and `timeline.removed` handlers, subscribes, then fetches the newest
  history page. Reconciliation replaces the authoritative newest coverage while preserving older pagination, live
  rows that raced with restore, and removal tombstones. A partial old stream is cleared by D29, not reconstructed.

### Mounted-page revalidation

- Navigation away and back is never the refresh mechanism for mutable server-owned data. A mounted page either consumes
  a committed notification with a durable cursor, or performs bounded idempotent revalidation on a named lifecycle
  signal such as focus, visibility restoration, config/client generation replacement, or explicit invalidation.
- Prefer a real producer notification when Core already owns a meaningful event. Do not invent a dead subscription for
  data that has no producer, and do not create unrelated per-page polling loops. A bounded timer is allowed only when
  the source has no event seam and the child task defines interval, visibility pause, cancellation, and request budget.
- A background refresh preserves last-good content and sets `refreshing`; it does not regress to first-load `loading`.
  Failed revalidation marks the view stale/error without discarding readable last-good data. Retired-generation results
  are ignored through the same generation guard as restoration.
- Lazy/older-page reads preserve selection and cursor truth. Tail-following is suspended while the user inspects older
  rows; a live append may expose a new-items affordance but must not steal scroll position.
- Chat text, tool-call, tool-result, and approval presentation follows the actual event arrival order. A final assembled
  timeline row reconciles/deduplicates in-flight records; it must not be the first opportunity to reveal a tool event
  that was already delivered live.

### Honest UI behavior

- `connectionStatusNotice` is the single status-to-copy mapping. Connected has no notice. Non-chat Home pages show
  Home status; Chat shows its independent status; Pet uses the existing transparent notice area.
- Connection-dependent actions are disabled or fail fast while their owning authenticated client is absent. Cached
  data and local drafts stay rendered; there is no disconnected command queue.
- A Pet bubble submit known to be reconnecting keeps its draft. The hook also rejects a stale closed client rather
  than leaving a turn pending.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Transport factory/client factory throws | Publish reconnecting and schedule a jittered retry |
| Socket closes before open | Reject every `whenOpen` waiter; retire once; retry |
| A request/cleanup reaches a non-OPEN native socket | Reject before browser dispatch; settle the RPC and release its deadline without a closed-socket console error |
| Open consumes the total open/auth budget | Close/retire candidate; do not send `connect` afterward |
| Pairing is required or auth is refused | Publish the specific terminal state; do not blind-retry |
| A stored operator token is rejected with `AUTH_FAILED` | Clear only the token, keep the stable `deviceId`, create one fresh generation, then publish terminal `AUTH_FAILED` if it is rejected again |
| Restore report/subscribe/history fails | Retire candidate and retry; never publish a false connected state |
| Old-generation callback arrives late | Ignore it through generation/disposal guard |
| Native JSON-RPC timeout fires | Throw `RpcDeadlineExceededError`; library pending ID is removed |
| Timed-out mutation later succeeds remotely | Do not replay; reread or let explicit user retry determine truth |
| Timing refresh is invalid/unavailable | Keep last-good policy and report a diagnostic |
| Core is unavailable while a page has cached data | Keep cached data visible; disable owned actions; show status |
| Timeline row is removed during restore | Preserve the tombstone so newest history cannot re-add it |
| Mounted page receives a committed invalidation | Revalidate in place; do not require navigation/remount |
| Background revalidation fails | Preserve last-good content, mark stale/error, and permit explicit retry |
| Retired-generation refresh settles late | Ignore it; it cannot replace current-generation content |
| User is inspecting an older page when live rows arrive | Preserve scroll/selection and expose pending new content without forcing tail-follow |

## 5. Good / Base / Bad Cases

- Good: Pet socket closes -> Pet alone shows reconnecting -> a fresh client authenticates, reports the live scene,
  subscribes once, then publishes connected; one later motion and expression reach the scene once.
- Good: Home reconnects while Chat remains healthy. Settings pages keep last-good content and revalidate from the new
  Home client without disturbing the Chat stream.
- Good: Perception stays open while its source changes; a producer notification or bounded focus/visibility
  revalidation updates the card in place and shows a non-blocking refreshing state.
- Base: an interactive mutation exceeds its deadline. Busy state releases, the UI names the unknown outcome, and no
  automatic retry occurs.
- Base: Core sends a timing change. The current operation keeps its captured timer; the next operation uses the
  validated full-policy refresh.
- Bad: reuse the same closed `WsClient`, share one socket between windows, publish connected before restoration, queue
  commands offline, use `Promise.race` around bare JSON-RPC requests, or require page remount to observe current data.

## 6. Tests Required

- `connection-generation-controller.test.ts`: fresh generations, full-jitter/cap, stability reset, refusal terminal
  states, stale callbacks, exact-once retirement, and disposal.
- `ws-client.test.ts`: close-before-open, total open/auth budget, pending request/D29 settlement, native timeout cleanup,
  concurrent request isolation, late responses, config subscription memoization, and handler fan-out.
- `ws-transport.test.ts`: CONNECTING/CLOSING/CLOSED never dispatch a native send; OPEN sends are unchanged. An actual
  `createWsClient` cleanup request rejects immediately and leaves no request-deadline timer.
- `timing-policy-schema.test.ts`, `timing-policy.test.ts`, `timing-policy-sync.test.ts`: complete keys, cross-field
  validation, last-good retention, serialized reread, and live-change behavior.
- `restore-pet-connection.test.ts`: callback -> truthful report -> subscribe order, restoration failure, stale generation,
  and reconnect report recovery.
- `restore-chat-timeline.test.ts` plus store tests: subscribe-before-history, live-race dedup, removal tombstones,
  authoritative newest reconciliation, and older cursor preservation.
- Monitor controller/view tests: retired-generation suppression, disabled-state clearing and Home-row removal,
  list/trajectory pagination, semantic grouping/details with no technical identity/copy fallback, live cursor
  continuation, overflow recovery, and explicit unsubscribe on rebind/disposal.
- Reactive page tests: focus/visibility/invalidation revalidation, one in-flight refresh, last-good preservation,
  stale/error recovery, disposal cancellation, lazy-page cursor/selection retention, tail-follow suspension, and
  incremental tool-call/tool-result/approval reconciliation without final-row duplication.
- Readiness component tests: settings, operations, perception, costume import/refresh, Home composer, and Pet bubble keep
  truthful disabled/draft behavior while their owning connection is unavailable.
- Manual: real three-window Core stop/start, independent status surfaces, one post-recovery push per channel, Pet
  transparency, long-idle avatar command, packaged Tauri ACL, and sleep/resume when practical.

## 7. Wrong vs Correct

```typescript
// Wrong: the closed generation remains the only client and callers invent their own timeout wrappers.
const client = createWsClient({ transport: createBrowserTransport(url) });
await Promise.race([client.configSet(input), delay(15_000)]);

// Correct: the owner replaces whole generations; WsClient owns native per-request cleanup.
const controller = createConnectionGenerationController({
  transportFactory: () => createBrowserTransport(url),
  clientFactory: ({ transport, timingPolicy }) => createWsClient({ transport, timingPolicy }),
  authenticate,
  restore,
  timingPolicy,
});
controller.start();
```

```typescript
// Wrong: the only way to see server changes is to unmount/remount the page.
useEffect(() => { void client.read(); }, [client]);

// Correct: one disposable read model revalidates on explicit lifecycle signals and ignores retired generations.
const model = createReactiveReadModel({ client, generation, read, subscribeInvalidation });
void model.refresh("mount");
```
