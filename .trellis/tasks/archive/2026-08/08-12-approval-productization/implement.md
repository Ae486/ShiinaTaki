# Approval Productization — C+E Host/Convergence Wave Execution Plan

> Leader plan for completing the remaining Slice 4 vertical. Batches A and B+D are committed
> (`cd67ad0`, `2c1c4e5`). An interrupted C-wave patch is present in the worktree; this plan
> preserves its sound schema/protocol layer and completes the Core/Rust integration plus Batch E.
> Execute as ONE coherent wave. No intermediate formal check; the Slice receives its single final
> xhigh `trellis-check` only after this plan is complete.

## Starting state (verified 2026-08-16)

- Shared protocol v3 layer is COMPLETE and green: `host-approval-schema.ts` (challenge/resume/
  authorization schemas, domain-separated canonical serializers), 4 golden fixtures, re-exports,
  focused tests 2 files / 56 tests pass.
- Rust `host_approval_protocol.rs` is COMPLETE in isolation: strict DTOs, canonical digests,
  RFC 3339 + UUID validation, fixture-pinned digests. `Cargo.toml` adds `time` + `uuid`
  (owner-approved); **`Cargo.lock` is not regenerated yet**, so `cargo test --locked` fails.
- Core is structurally incomplete: `capability-broker-state.ts` and `capability-response.ts`
  exist but are NOT integrated into `capability-broker.ts`; `route-capability.ts` already targets
  the new `CapabilityDispatchTarget` (hence the type errors); `approval-interaction-service.ts`
  has generation/policy listeners (append-only arrays).
- Core typecheck fails exactly at: `CapabilityRouteDeps.approval` missing in `main.ts` + tools
  + tests; `connection` not in the live `CapabilityDispatchTarget`.
- Missing entirely: Core `capability.challenge` handler, Core `capability.resume` dispatch,
  Rust ask→challenge transition, Rust pending challenge/input storage + one-time resume
  consumption, terminal authorization lineage enforcement, Batch E.

## Frozen contract reminders (do not redecide)

- Challenge direction: Node → Core (same provenance rules as `capability.respond`).
  Resume direction: Core → Node notification (same connection, current generation only).
- ONE Approval authority: reuse the existing `ApprovalInteractionService` and its physical
  operator `Connection` ownership. No second dialog, decision file, or session store.
- The Host NEVER prompts locally and never persists an allow. Raw capability input is
  memory-only everywhere (Core pending state, Rust `HostSession`, logs, audit, errors, crash).
- Authorization is single-use, digest-bound (`controlDigest` + `challengeDigest` +
  `decisionScopeDigest`), generation-bound (`approvalGeneration`), and short-lived (`expiresAt`).
- Terminal frames for an ask-classified execution MUST carry `authorization` lineage; Core
  rejects completed/failed frames under non-`auto` posture without matching lineage
  (`capability-response.ts` already encodes this — integrate it, do not duplicate it).
- Stricter-only: Host effective posture ≥ projected posture. Legacy denies stay effective;
  legacy allows/session writers remain inert.
- Fail-closed on: replay, tamper (digest/generation mismatch), expiry, cancellation,
  disconnect, policy invalidation, approval-generation change, wrong connection, unknown request.

## Phase 0 — Integrate the interrupted state split (repair typecheck first)

1. Adopt `CapabilityDispatchTarget`, `PendingCapability`, `TerminalRecord`,
   `CapabilityBrokerState` from `capability-broker-state.ts` inside `capability-broker.ts`;
   route terminal verification through `capability-response.ts` (`terminalFailure`,
   `responseOutcome`) for both live and bounded terminal-cache settlement.
2. Wire `approval: ApprovalInteractionService` through every `CapabilityRouteDeps` consumer:
   `main.ts` tool construction, screenshot/shell-open/process-list tools, and their tests.
3. Plumb the initiating operator: the operator `Connection` (+ optional `AbortSignal`) must
   reach `routeCapability` from the turn that invoked the tool (per-turn construction or an
   equivalent context carrier). Unattended turns carry NO operator; their `ask` must fail
   closed with a bounded timeout and a truthful reason — never an ambient prompt and never a
   silently widened grant.
4. Register broker generation/policy listeners ONCE at broker construction
   (`onApprovalGenerationChanged`, `onPolicyInvalidated`) to retire pending challenges and
   suppress resume issuance. Never subscribe per request (append-only listener arrays leak).
5. Deliberately regenerate `Cargo.lock` (`cargo check` in `apps/desktop/src-tauri`), inspect the
   resolved `time`/`uuid` versions, and commit the lockfile as part of this wave. All later Rust
   gates must pass `--locked`.

Gate: `pnpm --filter @taki/core typecheck` green; `cargo test --locked --lib` compiles.

## Phase 1 — Batch C: challenge/resume vertical

### Core

6. Host `ask` no longer settles as terminal `APPROVAL_REQUIRED` for challenge-capable
   requests: the broker keeps the pending request alive (memory-only raw input) while the Host
   emits `capability.challenge`.
7. Add the Core `capability.challenge` handler. Validate BEFORE any approval work: sender is
   the authenticated Host owning the pending `requestId`; current connection + catalog +
   policy generations match the sealed control; `controlDigest`/`challengeDigest` recomputed
   from canonical serializers match; decision scope digest is well-formed; governance evidence
   is consistent with the dispatched projection; presentation passes the shared schema.
8. Bridge to the EXISTING single interaction: `ApprovalInteractionService.request` against the
   initiating operator connection, reusing the B+D presentation/disclosure/acknowledgement
   machinery. On allow: mint `CapabilityAuthorization` (fresh `authorizationId`, current
   `approvalGeneration`, exact digests, bounded `expiresAt`), store it in the pending record,
   and send `capability.resume` to the same current Host connection. On deny/timeout/close:
   settle the request denied/cancelled and notify the Host of retirement.
9. Revalidate before resume dispatch AND before accepting the terminal frame: governance
   dispatch policy, full lineage (`isCurrent`), approval generation, and expiry. A resume that
   cannot be proven current is never sent; a terminal frame without valid lineage never
   settles success (convert to denial per `capability-response.ts`).
10. Invalidation hooks: timeout, cancel, operator-connection close, Host disconnect/retire,
    `invalidatePolicy`, approval-generation change must all retire the pending challenge,
    release the interaction handle, and record bounded terminal state (`late`/`cancelled`).

### Rust

11. `ws_client.rs` / `host_control_protocol.rs`: replace the terminal `APPROVAL_REQUIRED`
    ask return with a strict `capability.challenge` emission carrying the sealed control,
    digests, governance evidence, and redacted presentation. No native dialog, no stored
    decision, no raw input in the frame.
12. `host_session.rs`: store the pending challenge and raw input in memory keyed by
    `requestId`/`challengeId` (survives the in-process resume; never disk/log/audit). On
    `capability.resume`: revalidate authorization (UUID, digests against stored challenge,
    `approvalGeneration`, `expiresAt`, current local/managed constraints), CONSUME the stored
    challenge exactly once, execute at most once, and emit `capability.respond` with the
    authorization lineage. Duplicate/resumed-after-terminal/mismatched frames are rejected
    (`duplicate`/`late`/`stale_generation` semantics from the existing cache).
13. Keep cooperative cancellation semantics: accepted late settlement is suppressed; forced
    close of a side effect settles `outcome_unknown`, never a fabricated rollback.

### Tests (focused, per layer)

14. Shared: extend golden fixtures for a respond frame carrying authorization lineage (valid +
    invalid: wrong authorizationId/generation/digest, lineage-without-ask, ask-without-lineage).
15. Core: challenge handler provenance/digest/tamper matrix; resume minting + one-use; all
    invalidation hooks; same-`deviceId` two-socket ownership; no-operator fail-closed; pending
    raw input absent from logs/timeline/cache (sentinel probes).
16. Rust: parse/validate challenge + resume; digest recomputation; one-time consumption;
    replay/expiry/tamper rejection; memory-only pending input.
17. Real process: extend the `withStack` harness with one Core + operator + `taki-node`
    scenario proving challenge → operator allow → resume → single execution → lineage settle,
    plus one fail-closed case (deny or tamper). Real two-Node routing stays deferred to Slice 8.

## Phase 2 — Batch E: legacy, privacy, convergence

18. Legacy reconfirmation: verify exact legacy denies still bind; legacy allows/session
    writers remain inert; the canonical reconfirmation path (B+D operator surfaces) targets
    canonical identity + current future-background disclosure only. Add focused regressions.
19. Historical raw-input disposition — Leader decision: implement the focused idempotent scrub
    as migration `016` (bounded to the known legacy timeline raw-input columns), with reopen
    evidence and a downgrade-safe rollback note. Read sanitization stays as defense in depth.
    The sentinel test must prove absence from SQLite after scrub.
20. Process/privacy convergence: sentinel raw input absent from SQLite, decision files, logs,
    audit, timeline, caches, error responses, and crash diagnostics across the vertical.

## Phase 3 — Full verification (run in this order, record outputs)

```powershell
pnpm --filter @taki/shared typecheck && pnpm --filter @taki/shared exec vitest run src/host-approval-schema.test.ts src/protocol-fixtures.test.ts src/host-control-schema.test.ts
pnpm --filter @taki/core typecheck && pnpm --filter @taki/core exec vitest run src/approval src/capabilities src/governance
pnpm --filter @taki/core exec vitest run            # full Core suite
pnpm --filter @taki/cli typecheck && pnpm --filter @taki/cli test
pnpm --filter @taki/desktop typecheck && pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop build
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
git diff --check
```

Plus: changed-production-file ESLint, INPUT/OUTPUT/POS header audit on every changed file,
affected `index.md` updates, and the focused e2e scenario from step 17.

## Exclusions (do NOT build here)

Heartbeat, Scheduled Task, Autonomous Run history, Run Receipts, MCP CRUD/reload, Skill
lifecycle UI, Host secret catalog, broad cross-Host failover, artifact transfer, a second
permission surface, or any Taki-private Skill/MCP format. Do not weaken Batch A/B+D contracts.

## Rollback points

- Phase 0 is a pure integration repair; if the state split proves unsound, revert to the
  committed `2c1c4e5` broker shapes and re-derive, keeping the Shared schemas.
- Each phase stays independently fail-closed: an incomplete Phase 2 must leave production
  `ask` fail-closed rather than half-released.
