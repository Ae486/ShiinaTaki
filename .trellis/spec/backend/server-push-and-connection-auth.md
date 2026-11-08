# Server-Push Channels & Connection Auth (established #16)

Two reusable backend patterns from the avatar/bubble work.

## Receive fairness

The WS server uses the installed `ws` option `allowSynchronousEvents: false`. Coalesced status requests can
otherwise run several synchronous publication checks without returning to the event loop, delaying provider
response processing past its unchanged deadline. Yield between received frames; retain every authentication,
role, authority and publication check. This adds per-frame scheduling overhead and is not a bound on one
handler or on aggregate work from multiple connections. Keep the real-socket burst regression and distinguish
that scheduling evidence from connected Native timeout acceptance.

## Server→client push channel (the timeline/avatar fan-out pattern)

When the Core must push events to a subscribed client mid-turn (timeline entries, avatar commands), clone the established fan-out — do NOT invent a new mechanism:

- `server/<x>-subscriptions.ts` — a `Map<characterId, Map<Connection, sink>>` with `subscribe / unsubscribe / publish / count`; `publish(payload)` fans to every sink registered for `payload.characterId`.
- `server/methods/<x>-subscribe.ts` — role-gated (`["operator"]`), calls `subscriptions.subscribe(characterId, connection, (p) => ctx.notify(METHOD, p))` and `ctx.onClose(() => unsubscribe(...))` for auto-cleanup on socket close.
- The producer (conversation store's `onAppend`, an avatar tool's `execute`) calls `subscriptions.publish(...)`. Fan-out is synchronous → the event reaches the client the instant it's produced, even mid-turn.
- Reference impls: `server/timeline-subscriptions.ts` + `server/methods/timeline-subscribe.ts`; `avatar/avatar-subscriptions.ts` + `server/methods/avatar-subscribe.ts`.
- **A snapshot with no producer is a READ, not a channel.** The perception/activity card shipped as the operator-only one-shot `perception.card` (T3b) because nothing PUBLISHES a perception change — the state is polled in the background and read on demand. Clone the fan-out when a producer exists and the client must learn mid-turn; otherwise a `media.usage`-shaped read method is the honest surface (a subscription with no publisher is dead wiring).

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
  duplicate Core memberships.
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
