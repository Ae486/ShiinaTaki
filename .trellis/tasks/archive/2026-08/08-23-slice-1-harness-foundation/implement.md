# Slice 1 Harness Foundation Implementation Plan

This plan is executable only after the child task is reviewed and explicitly activated for implementation. Creating this
child and completing planning artifacts is not production implementation authorization.

## 1. Preparation and Context

1. Recheck `H:/TakiAgent-worktrees/t4`, branch, parent/child task binding, main hash, staged merge state, and dirty
   files. Do not touch `H:/TakiAgent` or `H:/hindsight`.
2. Read the child PRD/design, parent Phase B-E research, `docs/T4-HANDOFF.md`, `CONTEXT.md`, and applicable backend
   specs before editing.
3. Use the existing PI/DSH research as the architecture source. Do not repeat broad reference research unless a specific
   implementation question is genuinely unresolved.
4. If code location is unknown, use one focused `jbcontext search` from this worktree, then direct reads and `rg`.
   YCE is disabled and must not be used.

## 2. Implementation Order

### Step 1 - Freeze Shared contracts

- Add additive Zod schemas and exports for Trigger Request, Run, Attempt, snapshot references, outcomes, and minimal
  Receipt/query responses.
- Add schema tests for required identity containment, valid states, bounded fields, and refusal of malformed/secret
  payloads.
- Do not replace existing Memory/Hindsight exports or introduce a second protocol authority.

### Step 2 - Allocate and implement persistence

- Recheck the synchronized migration registry. Allocate the next version only after confirming main has not advanced;
  never reserve a number from this planning artifact.
- Add the smallest migration and one repository per real aggregate for Run, Attempt, current Operation state, snapshot
  references, and minimal Receipt/query data.
- Add expected-version checks, unique idempotency constraints, terminal settlement guards, and bounded error/outcome
  fields.
- Run fresh, historical T4, committed main, and legal Hindsight lineage tests before accepting the migration.

### Step 3 - Add the Core Run/Admission service

- Implement one provider-neutral Admission boundary that validates Trigger Requests, applies idempotency, selects the
  existing Character lane, captures the immutable snapshot, creates a Run, and starts an Attempt.
- Implement legal Run/Attempt transitions, durable cancel request, idempotent settlement, stale/late callback handling,
  and minimal status/Receipt query.
- Keep Operation as Run-owned state; do not add a separate operation aggregate or public `operationId` track.
- Await provider-neutral snapshot reads before the synchronous admission transaction; never await inside
  `db.transaction`. Commit the queued Run, immutable snapshot, and first prepared Attempt before returning the ack.

### Step 4 - Adapt the existing chat runtime

- Thread a narrow turn-kind/autonomous input through `chat-send.ts`/`chat-agent.ts` or the smallest composition seam
  proven by live code.
- Preserve primary full-turn persistence, cancel-before-reply retraction, approval denial, overflow retry, tool-tail
  persistence, and extension context reuse.
- Suppress primary-only behavior for non-primary turns: fake user row, costume notice, user-row retraction, and
  conversational auto-memory watermark advancement.
- Keep autonomous model control input separate from persisted user content and continue using the single
  `ToolLoopAgent`.
- Extend the `chat.send` acknowledgement to `{ messageId, runId }`. The ack proves durable admission/queueing only.
- Write no relationship Timeline rows for non-primary turns in Slice 1; persist bounded outcome evidence through the
  Run/Attempt/Receipt path.

### Step 5 - Add minimal query/Receipt integration

- Register the narrowest Core query/status method needed to inspect a Run by `runId`.
- Keep live chat notifications and Timeline subscriptions as projections/transport; they cannot settle Run state.
- Redact prompt bodies, secrets, raw tool payloads, Host/MCP credentials, and sensor/media content by construction.

### Step 6 - Update docs/specs and prepare later seams

- Update touched `index.md` files, executable specs, and deferred decisions when a deferral is introduced.
- Record the exact provider-neutral seam for future Scheduled Task, Heartbeat, Child Run, event ledger, and recovery
  consumers without implementing those consumers.
- Update the parent roadmap/HANDOFF only when implementation evidence changes the adopted architecture.

## 3. Delegation Strategy

Use delegation only for bounded, independently reviewable work. Every child prompt must be in English and start with the
active task path. It must state owned files, required specs/research, verification commands, no-commit boundary, and the
report categories `completed`, `incomplete`, `unverified`, `extra changes`, and `residual risk`.

Every prompt must also state:

```text
YCE is disabled and must not be used.
Use jbcontext for semantic code search, then direct reads and rg for exact follow-up.
Do not spawn child agents.
```

The leader decides whether a targeted explore is needed. Existing research is the default context; an explore agent must
not restart PI/DSH research or duplicate the parent audit.

## 4. Verification Gates

### Focused gates

- Shared schema tests and Core Run/Attempt transition tests.
- Repository idempotency, duplicate/late completion, cancellation, stale generation, and snapshot immutability tests.
- Primary chat regression suite and non-primary turn isolation tests.
- Fresh and historical migration lineage tests, including no-op reopen.
- Core boot with a unique temporary data directory and port.
- Redaction/privacy tests for Receipt/query output.

### Final full-scope gate

Run the backend quality gate from the current T4 worktree:

```text
pnpm -r --parallel typecheck
pnpm lint
pnpm -r --parallel test
pnpm --filter @taki/desktop build
pnpm --filter @taki/e2e exec vitest run
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings
git diff --check
```

Run final `trellis-check` across every changed package/layer. Manual packaged-product acceptance remains owner-owned.

### Owner manual acceptance (2026-08-24)

The owner completed the Slice 1 product-path check after the focused automated gates:

- Core and Desktop started successfully in a fresh pairing environment; pairing completed successfully.
- With the configured DeepSeek provider, ordinary conversation worked end to end.
- The `exec` tool worked through the approval flow and produced the expected result.
- No additional Slice 1 defects were observed during manual testing.
- A stale operator token was also verified to recover by clearing only the token and reconnecting with the stable
  device identity; an initially unpaired Shell still follows the separate `PAIRING_REQUIRED` flow.

This is owner acceptance for Slice 1 only. It does not close the later Scheduler, Heartbeat, event-ledger, recovery,
Child Run, or packaged-product acceptance work. The concrete-command Approval presentation gap is recorded as D64.

## 5. Rollback and Stop Conditions

- Do not use destructive Git operations. Stop before implementation if main advances or the staged merge is discarded;
  re-run semantic synchronization review first.
- Stop if the migration lineage is ambiguous, a shared export requires whole-file replacement, or a provider-specific API
  leaks into the provider-neutral Run contract.
- Stop if primary chat regression cannot be explained and fixed without changing the accepted primary behavior.
- Stop if non-primary execution would require fake Timeline/user rows or hidden conversational Memory mutation.
- Roll back by preserving the pre-migration database backup and reverting only the child-owned files; no down migration or
  main-worktree cleanup is assumed.

## 6. Delivery Boundary

The child is complete only when the implementation and final check evidence show the unified Run foundation works without
claiming Scheduler, Heartbeat, event-monitor, recovery-worker, or manual product acceptance that was not delivered.
