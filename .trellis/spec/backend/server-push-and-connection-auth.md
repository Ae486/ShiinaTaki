# Server-Push Channels & Connection Auth (established #16)

Two reusable backend patterns from the avatar/bubble work.

## Server→client push channel (the timeline/avatar fan-out pattern)

When the Core must push events to a subscribed client mid-turn (timeline entries, avatar commands, future activity cards), clone the established fan-out — do NOT invent a new mechanism:

- `server/<x>-subscriptions.ts` — a `Map<characterId, Map<Connection, sink>>` with `subscribe / unsubscribe / publish / count`; `publish(payload)` fans to every sink registered for `payload.characterId`.
- `server/methods/<x>-subscribe.ts` — role-gated (`["operator"]`), calls `subscriptions.subscribe(characterId, connection, (p) => ctx.notify(METHOD, p))` and `ctx.onClose(() => unsubscribe(...))` for auto-cleanup on socket close.
- The producer (conversation store's `onAppend`, an avatar tool's `execute`) calls `subscriptions.publish(...)`. Fan-out is synchronous → the event reaches the client the instant it's produced, even mid-turn.
- Reference impls: `server/timeline-subscriptions.ts` + `server/methods/timeline-subscribe.ts`; `avatar/avatar-subscriptions.ts` + `server/methods/avatar-subscribe.ts`.

**No Rust serde mirror for operator-only channels.** Invariant 3 mirrors only shapes the Rust Shell (a *node*) actually handles — connect/capability/approval. `chat.*`, `timeline.*`, `avatar.*` are operator↔core direct (the Pet UI webview + CLI open their own loopback WS as operators); the Rust Shell never sees these frames, so they live in `@taki/shared` zod only. Test their round-trips in a standalone `<x>-schema.test.ts`, NOT `protocol-fixtures.test.ts` (that sweep asserts a Rust serde struct per prefix — adding an unmirrored prefix reds the cargo side).

## Connection auth ≠ capability authorization (two distinct gates)

Do not conflate them:

| Gate | Question | Where | Keyed on |
|------|----------|-------|----------|
| **Connection auth** (`connect.ts`) | may this *device* attach, and as what role? | the one pre-auth method | token / pairing / loopback-auto-trust; role locked at issuance |
| **Capability authorization** (Permission Gate, Rust) | may this *action* run? | per capability request | see `permission-authorization.md` |

### Loopback auto-trust (P3) — the local-operator connection rule

An operator on the trusted machine boundary needs no pairing ceremony (localhost is the security boundary; interactive pairing is a remote-device pattern — see D23). The rule, in `connect.ts` order:

1. token branch (verify → authenticate, or fail-closed `AUTH_FAILED` + socket close),
2. pairingCode branch,
3. **auto-trust**: fires ONLY when `trustLoopbackOperator` (config, default on) AND `role === "operator"` AND `isLoopback(remoteAddress)` — then issue a token (the SAME `issueToken` pairing uses; reconnect works even if the flag later flips) + authenticate,
4. else `beginPairing` / `PAIRING_REQUIRED`.

Non-negotiable safety properties (all enforced + tested; a change here is a security review):

- **Ordering is fail-closed**: a wrong token fails in branch 1 and NEVER reaches auto-trust, even on loopback+flag-on.
- **Operators only**: nodes carry capabilities → the Permission Gate → must still pair. Auto-trusting a node is a real escalation.
- **`isLoopback(undefined) === false`**: an unknown/absent peer address falls to pairing (fail-closed). Address comes from the WS upgrade transport peer (`request.socket.remoteAddress`), never a spoofable header; exact-set membership {127.0.0.1, ::1, ::ffff:127.0.0.1}, not a loose prefix/CIDR that could over-match.
- **The flag is an auth kill-switch → parse it fail-closed**: default on; disabling fully restores mandatory pairing for ALL peers (the VPS/public-Core posture). Accept only strict `true/1/false/0` (case-insensitive); garbage errors at boot, never silently means on.
- **Audit every mint**: auto-trust persists a credential → log it (deviceId/deviceName/remoteAddress; never the token), same as pairing logs its code.
- Operator capabilities are schema-forced empty (`connect-schema.ts`), parsed before the handler → an auto-trusted operator can't smuggle capabilities.

Reference: `server/methods/connect.ts`, `devices/device-registry.ts` (`issueToken`/`trustDevice`), hardened by the fable5 security review (2026-07-14). Residual boundary notes (multi-user host, deviceId clobber) → deferred D25.
