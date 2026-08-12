# Research: WebSocket lifecycle libraries and JSON-RPC deadline options

- Query: Which installed APIs or established libraries can provide atomic WebSocket generation replacement, bounded reconnect, and initiator-owned JSON-RPC deadlines for D59/D61 without leaking pending requests?
- Scope: mixed (live repository, installed package source/types, pinned official package sources, standards/reference documentation)
- Date: 2026-08-07

## Finding labels

- **Verified** means the statement is grounded in the live working tree, installed package files, a direct runtime probe, or a pinned official source.
- **Inference** means the conclusion follows from verified behavior but has not been exercised in the Tauri application.
- **Gap** means evidence is unavailable or the value still requires an owner/PRD decision.

## Executive conclusion

**Recommendation:** use the current dependencies for this task. Add a small, framework-free connection-generation manager around the existing `WsTransport` factory and `createWsClient`, and use the installed `json-rpc-2.0@1.7.1` timeout requester for ordinary RPC deadlines. Do not add a reconnect package unless the owner explicitly prefers dependency ownership after the decision gates below.

This is not a recommendation to hand-roll a WebSocket protocol or JSON-RPC timeout map:

1. The browser keeps owning the physical WebSocket.
2. `json-rpc-2.0` keeps owning request IDs and pending-request cleanup.
3. The local manager owns only TakiAgent-specific lifecycle semantics that no evaluated library supplies: authentication, generation promotion, re-subscription/report ordering, old-client retirement, D29 chat settlement, window status, and disposal.

`websocket-ts@2.3.0` is a credible focused reconnect dependency if dependency ownership is preferred. It does not remove the need for the host manager and does not solve request deadlines. `reconnecting-websocket@4.4.0` has a useful connection-attempt timeout and mature API, but its latest release is from 2020 and its default unbounded outbound queue conflicts with this task unless explicitly disabled. `react-use-websocket@4.13.0` is broader than the seam and would move transport ownership into React hooks without solving JSON-RPC cleanup.

## Local sources and exact installed versions

| Source | Verified fact |
| --- | --- |
| `package.json:6-10,20-27` | The repository requires Node `>=24` and pnpm `>=10`; root tooling includes TypeScript `^6.0.0` and Vitest `^4.1.0`. |
| `apps/desktop/package.json:13-24` | Desktop uses React `^19.2.0` and `json-rpc-2.0` with specifier `^1.7.1`. No reconnect library is declared. |
| `pnpm-lock.yaml:38-40` | The resolved desktop JSON-RPC version is exactly `1.7.1`. |
| `apps/desktop/node_modules/json-rpc-2.0/package.json` | Installed `json-rpc-2.0` is `1.7.1`, MIT, CommonJS output with bundled declarations, and has no runtime dependencies. |
| Lockfile/package sweep | No `reconnecting-websocket`, `websocket-ts`, `react-use-websocket`, or `robust-websocket` package is installed. The lockfile's unrelated `@humanwhocodes/retry` is an ESLint transitive dependency and not an application reconnect primitive. |

## Installed `json-rpc-2.0@1.7.1` behavior

### Pending map and request creation

**Verified:** `JSONRPCClient` owns a private TypeScript field named `idToResolveMap` and an incrementing request ID (`dist/client.js:42-55`, `dist/client.d.ts:9-15`). `requestAdvanced` creates and stores one resolver per request ID before sending the payload (`dist/client.js:125-150`).

The send callback in TakiAgent is synchronous: it calls `transport.send(JSON.stringify(payload))` (`apps/desktop/src/lib/ws-client.ts:101-104`), and the browser transport delegates directly to `WebSocket.send` (`apps/desktop/src/lib/ws-transport.ts:17-25`). This matters because the library's timer resolves the pending response, but `requestAdvanced` still chains through the send promise. A future asynchronous send function that never settles would require a separate send/open deadline.

### Built-in timeout semantics

**Verified:** `JSONRPCClient.timeout(delay, overrideCreateJSONRPCErrorResponse?)` returns a `JSONRPCRequester` (`dist/client.d.ts:4-24`). For each request it:

1. reserves the request ID;
2. starts a timer;
3. looks up the resolver at expiry;
4. deletes that ID from `idToResolveMap`;
5. resolves the internal response promise with a synthetic JSON-RPC error, default message `Request timeout`;
6. clears the timer if a real response or error wins first.

The implementation is at `dist/client.js:57-97`. `requestWithID` then converts that synthetic error response into a rejected `JSONRPCErrorException` (`dist/client.js:98-119`).

`JSONRPCServerAndClient.timeout(delay)` exposes the timeout requester but does not expose the custom error-response callback (`dist/server-and-client.js:69-83`, `dist/server-and-client.d.ts:17-23`). The contained `rpc.client` is public in the declaration (`dist/server-and-client.d.ts:7-11`), so a host-specific error payload is technically available through `rpc.client.timeout(delay, override)`, but the simpler design is to translate the default timeout exception into a typed host error in one request helper.

### Close settlement and late responses

**Verified:** `rejectAllPendingRequests(message)` resolves every pending entry with a synthetic JSON-RPC error and clears the whole map (`dist/client.js:163-168`). TakiAgent calls this on transport close and separately aborts the current streaming chat turn (`apps/desktop/src/lib/ws-client-routes.ts:137-154`). Existing tests assert both chat settlement and ordinary-request rejection on close (`apps/desktop/src/lib/ws-client.test.ts:250-285`).

**Verified:** `receive` deletes the matching entry before resolving it. If no resolver exists, including after timeout or old-generation retirement, the response is ignored (`dist/client.js:169-180`). Therefore a late response cannot re-settle a timed-out caller.

### `Promise.race` leak answer

**Verified: yes, `Promise.race` alone leaks the JSON-RPC pending entry.** An outer timeout resolves/rejects only the caller's race. It does not call into `JSONRPCClient`, so the resolver remains in `idToResolveMap` until a real response arrives or the socket closes and `rejectAllPendingRequests` clears it.

A direct runtime probe against the installed package produced:

```text
afterOuterRace=1
builtinError=Request timeout
afterBuiltinTimeout=0
afterLateResponse=0
```

The probe created one request, let an outer race expire, inspected the installed JavaScript map, then repeated with `client.timeout(5).request(...)` and delivered a late response. This is test evidence for the installed artifact, not an API recommendation to access the private map from production code.

### Cancellation and timeout API limits

**Verified:** the installed declarations expose `request`, `requestAdvanced`, `timeout`, `notify`, `send`, `rejectAllPendingRequests`, and `receive`; there is no `AbortSignal`, cancel-by-ID, forget-by-ID, or reject-one-pending API (`dist/client.d.ts:4-24`).

Consequences:

- The built-in timeout is the only direct per-request deadline helper. A lower-level caller can assign its own unique ID through `requestAdvanced` and inject a synthetic response through public `client.receive`, but that requires host-owned ID/error/timer coordination.
- `rejectAllPendingRequests` is appropriate when retiring an entire connection generation, not for timing out one request.
- A local `Promise.race` plus `rejectAllPendingRequests` would incorrectly fail unrelated concurrent requests.
- A timeout stops local waiting; it does not cancel server execution. JSON-RPC 2.0 has no cancellation method in this application protocol.
- Mutating methods can have an **ambiguous outcome**: the Core may commit after the operator timed out. They must not be automatically replayed. The UI should reconcile by re-reading state or explicitly say the outcome is unknown.

## Viable request-deadline designs

| Design | Pending entry removed? | Late response | Scope/control | Verdict |
| --- | --- | --- | --- | --- |
| `rpc.timeout(ms).request(method, params)` | Yes, by installed library | Ignored because the ID is absent | One timeout wrapper per call; default `JSONRPCErrorException("Request timeout")` | **Recommended baseline.** No dependency or private-map ownership. |
| `rpc.client.timeout(ms, override).request(...)` | Yes | Ignored | Can attach a host-specific JSON-RPC error/data shape | Viable, but couples the helper to the public `client` member and the library's response factory. Use only if a typed wire-shaped timeout is materially useful. |
| Caller-owned unique ID via `requestAdvanced`, then `client.receive(syntheticError)` on timer/abort | Yes, through public `receive` | Ignored | Can support a true host `AbortSignal` and one-request settlement | Viable low-level escape hatch, but adds ID uniqueness, timer, error conversion, and send-race ownership. Reserve for a future real cancellation requirement. |
| Host `Promise.race` around `rpc.request` | No | Eventually settles hidden original request | Superficially simple | **Rejected.** Proven pending-map leak until response/close. |
| Host generates IDs and owns a second pending map | Potentially | Host-defined | Full cancellation/AbortSignal possible | **Rejected for current scope.** Duplicates the installed library and increases routing risk. Reconsider only if true per-request cancellation becomes a protocol requirement. |
| Timeout calls `rejectAllPendingRequests` | Yes, all IDs | All late responses ignored | Destroys unrelated concurrent calls | **Rejected for per-request use.** Keep for generation retirement only. |

### Recommended deadline seam

Add one internal request helper used by `handshake` and `requestMethods`, conceptually:

```ts
requestWithDeadline(rpc, policy, method, params)
```

The helper selects a PRD-approved duration, calls the installed timeout requester, and translates only the library's timeout error into a stable host `RpcDeadlineExceeded` error. Result schema parsing remains at the existing call sites.

The helper must preserve these distinctions:

- open/handshake deadline: retryable connection-generation failure;
- ordinary read/subscription deadline: fail the action and permit a fresh read after recovery;
- mutation deadline: fail with outcome-unknown semantics and do not replay automatically;
- accepted chat stream: the request acknowledgement can have a deadline, but stream completion remains governed by `chat.complete`/`chat.error` and D29 close settlement. Do not apply an ordinary-RPC timer to the whole streamed turn without a separate product decision.

**Gap:** the repository contains no approved numeric deadline table. `character.import` and maintenance operations plausibly need a different budget from loopback reads, but measured latency evidence was not found. The PRD/owner must freeze durations; this report does not invent them.

## Current browser transport seam

**Verified:** `WsTransport` is intentionally minimal: `send`, `close`, and additive `onMessage`/`onOpen`/`onClose` registration (`apps/desktop/src/lib/ws-transport.ts:8-15`). `createBrowserTransport` constructs exactly one global browser `WebSocket` and does not expose ready state, error events, listener removal, or a constructor/factory injection point (`apps/desktop/src/lib/ws-transport.ts:17-28`).

**Verified:** `bindTransport` has a one-shot `opened` boolean. Its `whenOpen()` waiters resolve only on open; close does not reject those waiters (`apps/desktop/src/lib/ws-client-routes.ts:138-158`). A socket that closes before opening can therefore leave `connect()` waiting forever unless the generation/open attempt has its own deadline or the binding is changed to settle waiters.

**Verified:** the current fake transport captures handler arrays and exposes deterministic `open`, `deliver`, and `closeSocket` controls (`apps/desktop/src/lib/ws-client.test.ts:13-41`). It is already a good base for request and close tests but represents only one transport generation.

**Inference:** native `WebSocket` does not reconnect itself. MDN documents construction plus `send`/`close` and open/message/error/close events, and its client guide explicitly creates a new `WebSocket` when starting again. No reconnect method is present. Source: [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) and [Writing WebSocket client applications](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications).

## Reconnection options

### Comparison matrix

| Option | Reconnect / cleanup | Backoff and jitter | Testability | Bundle/runtime fit | What remains host-owned | Assessment |
| --- | --- | --- | --- | --- | --- | --- |
| **Current dependencies + local generation manager** | Host schedules a new `WsTransport`/`WsClient`; disposal cancels the timer and closes the candidate/current transport | Implement the authoritative full-jitter formula below with injected RNG; PRD supplies base/cap | Best fit with queued fake transports, fake timers, injected scheduler/RNG | No dependency/bundle addition; uses the same native WebSocket already running in Tauri WebView2; Node 24 only runs tests/build | Everything Taki-specific, but that is required under every option | **Recommended.** Smallest complete ownership boundary. |
| **`websocket-ts@2.3.0`** | Focused wrapper creates replacement native sockets; `close()` cancels scheduled retry and prevents further retry; listener removal exists; max retries optional | Constant, linear, exponential, or custom `Backoff`; no built-in jitter in verified source; no connect-attempt timeout found | Library uses global `WebSocket`, so tests must replace the global or wrap it; retry events are observable | MIT, no dependencies, browser-native, CJS+ESM, official README claims 2.5 kB minified+gzip; published 2026-03-29. Tauri browser fit is direct. Node 24 compatibility is not claimed but Node is not its desktop runtime. | JSON-RPC deadlines, open timeout, auth, ready gating, no-offline-send policy, client generation, subscriptions/reports, D29 chat, UI status | Credible dependency fallback, but it saves only raw socket retry code. Adding it requires owner approval and a compatibility spike. |
| **`reconnecting-websocket@4.4.0`** | WebSocket-compatible facade, custom constructor, `close` stops reconnect, connection-attempt timeout, max retries, listener removal | Defaults: max 10 s, min `1 s + random * 4 s`, grow factor 1.3, min uptime 5 s, connection timeout 4 s. Random minimum is chosen once, not full jitter per attempt. | Custom WebSocket constructor is favorable for fakes | MIT, zero dependencies, browser/Node builds, about 21.4 kB ESM source in package. Latest release 2020-02-07; last reported push 2023, so current TS6/WebView2 compatibility is unverified. | All Taki-specific lifecycle and all request deadlines | Useful reference, not recommended without maintenance/compatibility acceptance. Default `maxEnqueuedMessages: Infinity` must be set to `0` to avoid replaying expired RPCs. |
| **`react-use-websocket@4.13.0`** | React hook owns open/close/unmount and optional reconnect/heartbeat/share | Configurable fixed/function reconnect interval; official README documents defaults of 20 attempts and 5000 ms | Hook tests need React/jsdom; less direct than the existing framework-free fake transport | MIT, current package 4.13.0 at pinned commit `17e52bb...` (2025-02-04). Project React 19 compatibility is not explicitly verified; docs say React 16.8+ and discuss React 18. Bundle size was not measured. | JSON-RPC deadlines, auth, generation promotion, subscriptions, D29, and preventing queued stale RPCs | **Rejected for this seam.** It moves transport logic upward into hooks and defaults to queueing pre-open messages (`sendMessage(..., keep=true)`). |

### Pinned official package evidence

- `websocket-ts@2.3.0`: [tag](https://github.com/jjxxs/websocket-ts/tree/v2.3.0), [package manifest](https://raw.githubusercontent.com/jjxxs/websocket-ts/v2.3.0/package.json), [implementation](https://raw.githubusercontent.com/jjxxs/websocket-ts/v2.3.0/src/websocket.ts), [Backoff interface](https://raw.githubusercontent.com/jjxxs/websocket-ts/v2.3.0/src/backoff/backoff.ts), and [release](https://github.com/jjxxs/websocket-ts/releases/tag/v2.3.0).
- `reconnecting-websocket@4.4.0`: [tag](https://github.com/pladaria/reconnecting-websocket/tree/v4.4.0), [package manifest](https://raw.githubusercontent.com/pladaria/reconnecting-websocket/v4.4.0/package.json), and [README/defaults](https://raw.githubusercontent.com/pladaria/reconnecting-websocket/v4.4.0/README.md).
- `react-use-websocket@4.13.0`: [pinned commit](https://github.com/robtaussig/react-use-websocket/tree/17e52bb4dc0b822ed3163a259fcf13cab6b44737), [manifest](https://raw.githubusercontent.com/robtaussig/react-use-websocket/17e52bb4dc0b822ed3163a259fcf13cab6b44737/package.json), and [README](https://raw.githubusercontent.com/robtaussig/react-use-websocket/17e52bb4dc0b822ed3163a259fcf13cab6b44737/README.md).

### Why a reconnect library cannot replace the host lifecycle

Every evaluated reconnect library operates at the physical-socket/facade layer. None understands the TakiAgent `connect` authentication method, token update, operator role, avatar/timeline/config subscriptions, avatar vocabulary report, initial page loads, D29 active chat turn, or connection status store.

Even if a library reuses one facade while replacing its underlying socket, TakiAgent still needs a logical connection generation. The current `bindTransport.whenOpen()` is one-shot; after its first open it returns immediately forever. A new physical open must not make the old logical JSON-RPC session authenticated. The host must re-authenticate and restore subscriptions before exposing the client as ready.

Offline send buffering must remain disabled. A request can expire locally while disconnected; sending its buffered frame after reconnection would execute a command whose caller has already abandoned it. This is especially unsafe for mutations.

## Recommended connection-generation design

**Inference based on verified seams:** a local manager can be small if it owns policy and delegates mechanics:

1. Accept `transportFactory`, `createClient`, scheduler/clock, RNG, connect params provider, and one generation-restoration callback.
2. Maintain one monotonically increasing generation ID and at most one candidate/current generation.
3. Create a fresh transport and `WsClient` for each attempt. Do not expose the candidate as ready.
4. Bound physical open plus handshake. On open, call `client.connect`; only an authenticated result continues.
5. Install local push handlers before requesting server subscriptions, then restore that window's subscriptions/reports/initial loads exactly once.
6. Promote the candidate atomically only after authentication and required restoration succeed. Publish `connected` then.
7. On unexpected close, immediately retire the generation, publish `reconnecting`, rely on existing `rejectAllPendingRequests` plus D29 `abortTurn`, and schedule the next factory call.
8. Every async continuation checks both `!disposed` and `generation === currentGeneration`; stale opens, auth results, pushes, and restoration completions self-discard.
9. `dispose()` cancels the scheduled timer, increments/invalidates the generation, closes candidate/current transport, and prevents the resulting close event from scheduling another attempt.
10. Do not queue or replay requests while no authenticated generation is ready. Callers receive an actionable disconnected/reconnecting error.

The manager should be framework-free under `apps/desktop/src/lib/`; React hooks subscribe to its state and supply window-specific restore behavior. One manager instance per pet, home, and chat window preserves the PRD requirement for independent sockets and chat state.

### Atomicity details

- **Old pending RPCs:** physical close already calls `rejectAllPendingRequests`; explicit manager retirement should be idempotent and must not settle twice.
- **Close before open:** change the transport binding or candidate wrapper so open waiters reject/settle; the generation deadline is a second safety net, not permission to retain waiters forever.
- **Stale events:** generation checks are required even if listeners are removed, because already-queued callbacks/promises can run after replacement.
- **Handler registration:** each new `WsClient` gets exactly one set of local push callbacks. Never re-register callbacks on the old client.
- **Ready definition:** `open` is transport-only; `connected` means authenticated and restored.
- **Authentication refusal:** pairing/auth failure is not the same as transient socket close. The manager must surface the specific terminal/refusal state rather than retrying indefinitely unless the PRD says otherwise.

## Backoff and jitter evidence

The most directly applicable established formula is exponential backoff with full jitter:

```text
delay = random(0, 1) * min(cap, base_delay * 2^retry)
```

AWS documents this formula, explains that full jitter spreads synchronized retries, and caps its SDK service retries at 20 seconds: [AWS retry behavior - How long does the SDK wait](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html#retry-backoff). The AWS base delays are service-specific HTTP retry policy, not evidence for a localhost desktop Core. This task may reuse the formula but must not copy AWS's base values without a product/latency reason.

Established package defaults are recorded above for `reconnecting-websocket@4.4.0`. `websocket-ts` deliberately has **no reconnect by default**; the caller must provide a backoff. Its documented `ExponentialBackoff(1000, 6)` is an example, not a default.

**Gap:** no D59-specific base delay, cap, stability-reset interval, maximum attempt count, or open/handshake timeout exists in current project config/docs. Required owner/PRD choices:

- retry forever with a bounded per-attempt delay, or stop after a maximum and offer manual retry;
- base and cap for the localhost Core restart UX;
- when a successful connection resets the exponent;
- whether a reconnect-now user action bypasses the current wait;
- physical open and authentication deadline values.

The deterministic implementation should inject RNG rather than call `Math.random()` inside state transitions.

## Dependency decision gates

Choose **current dependencies/local manager** unless one of these becomes true:

- a second non-React client needs the identical physical reconnect engine;
- dynamic URL failover, standardized heartbeat, or multiple transport implementations become product requirements;
- the local manager starts owning generic socket buffering/protocol mechanics rather than Taki-specific generation policy;
- a maintained library compatibility spike proves less code and equivalent deterministic cleanup.

Choose **`websocket-ts@2.3.0`** only after explicit approval to add a dependency and a spike proves:

- TypeScript 6 build passes;
- Tauri WebView2 open/close/retry events behave as documented;
- no buffer is configured;
- a host open-attempt timeout is added;
- a custom full-jitter `Backoff` or an owner-approved built-in strategy is used;
- disposal and fake-timer tests can observe/cancel every retry.

Do not choose `reconnecting-websocket@4.4.0` without accepting its maintenance age and testing TypeScript 6/WebView2. Do not choose `react-use-websocket` for this task unless the architecture is intentionally changed to make React hooks the transport owner.

## Deterministic test strategy

### JSON-RPC deadlines

Use Vitest fake timers and the existing fake `WsTransport`:

1. Start an ordinary request and withhold a response.
2. Advance to one tick before the policy deadline; assert still pending.
3. Advance to the deadline; assert one typed deadline rejection.
4. Deliver the old response after timeout; assert no state change, second settlement, or unhandled rejection.
5. Start two concurrent requests with different responses/deadlines; timing out one must not reject the other.
6. Close before deadline; assert connection-lost rejection wins and advancing timers causes no second settlement.
7. Test mutation timeout mapping separately: outcome unknown, no automatic retry.
8. Test connect timeout separately so it is not converted into a pairing refusal with `code: null` by the current broad `JSONRPCErrorException` catch in `handshake` (`apps/desktop/src/lib/ws-client-methods.ts:56-65`).

The installed package's private map can be probed in a package-integration test if desired, but production code must not depend on that private field. Behavioral tests plus the inspected implementation are the stable contract.

### Connection generations

Create a transport-factory harness that returns controlled generations `g1`, `g2`, ... and inject fake timers/RNG:

1. `g1` open -> assert `connect` is the first RPC; withhold auth -> no restore and no `connected`.
2. Resolve auth -> assert handler installation and the exact window restore sequence once; then `connected`.
3. Start a pending RPC and accepted chat turn, close `g1` -> both settle exactly once and status becomes `reconnecting`.
4. Assert the scheduled delay from deterministic RNG and capped exponent; advance time -> only one `g2` is created.
5. Deliver stale `g1` message/open/close callbacks -> no status, callback, timer, or state changes.
6. Authenticate `g2` -> assert subscriptions/reports occur only after auth and exactly once.
7. Repeat several close/open cycles -> handler and subscription counts equal successful generation count, never more.
8. Dispose during backoff -> timer cancelled, no next factory call.
9. Dispose during open/auth/restore -> candidate closes and all late continuations self-discard.
10. Open attempt or handshake hangs -> generation deadline retires it and schedules the next attempt.
11. Authentication refusal -> specific pairing/auth state; no blind transient loop unless owner-approved.
12. Call an action while reconnecting -> immediate explicit failure and zero queued frames.

Add one browser-transport adapter test with an injected/replaceable WebSocket constructor or global fake to confirm listener cleanup and close-before-open behavior. Keep the higher-level lifecycle tests independent of jsdom/browser timing.

## Related specs and records

- `.trellis/spec/frontend/hook-guidelines.md`: components cannot own WS calls; hooks expose asynchronous error state.
- `.trellis/spec/frontend/state-management.md`: connection state belongs in a window-local Zustand domain store; Core remains authority.
- `.trellis/spec/frontend/quality-guidelines.md`: framework-free lib seam, file/function limits, fake-timer tests, and no polling.
- `.trellis/spec/backend/server-push-and-connection-auth.md`: every socket authenticates independently; server subscriptions are per connection and close-cleaned.
- `.trellis/spec/guides/source-grounding-guide.md`: installed sources and pinned official sources precede implementation assumptions.
- Active PRD: `.trellis/tasks/08-07-ws-reconnect-request-deadlines/prd.md`.

## Caveats / Not Found

- No dependency was installed and no candidate was executed inside TakiAgent. Candidate compatibility is source/package evidence plus runtime-fit analysis, not an integration test.
- `websocket-ts@2.3.0` is current and focused, but its verified implementation uses global `WebSocket`, has no built-in jitter, and no connection-attempt timeout was found.
- `reconnecting-websocket@4.4.0` supplies a connection timeout but is maintenance-stale relative to TypeScript 6 and the current WebView2 runtime.
- `react-use-websocket@4.13.0` claims React 16.8+; explicit React 19 support evidence and a current bundle-size measurement were not found.
- Native WebSocket close timing for half-open network conditions is browser/OS dependent. A host deadline bounds requests and connection attempts, but a real Core stop/start manual test remains necessary.
- The evaluated libraries solve physical reconnect only. None solves JSON-RPC request deadlines, TakiAgent authentication, atomic logical generation promotion, subscription restoration, D29 stream settlement, mutation ambiguity, or window UX.
- No numeric deadline/backoff policy is approved in the repository. Those values remain an explicit PRD/owner decision rather than an implementation guess.
