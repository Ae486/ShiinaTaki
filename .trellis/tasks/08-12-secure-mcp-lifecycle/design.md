# Secure MCP Lifecycle — Technical Design

> Frozen contracts: `.trellis/tasks/08-10-skills-mcp-productization/info.md` (candidate/lease/drain/close/crash
> boundary), ZCODE-HANDOFF §8.4 (three state planes). Live seams:
> `research/live-mcp-lifecycle-seam-map.md` (file:line anchors). This document records implementation decisions.

## Desired state (plane 1) — SQLite migration 017

- New STRICT table `mcp_desired_servers` (one row per server): stable key, sanitized transport config JSON,
  selected tools list, opaque `secret-ref:` references (values NEVER here — catalog only), owner hostId
  (Core host for MVP), enabled flag, `configRevision` (per-row optimistic revision mirroring the
  `expectedPolicyGeneration` transactional pattern from `governance-policy-repo.ts`), timestamps.
- `mcp-servers.json` demotes to a legacy seed: read once at boot ONLY when the table is empty, AFTER
  `mcp-secret-migration` has run (boot-order pinned in main.ts). The secret migration's in-place rewrite and the
  seed read must not fight (risk §7.5 of the seam map).
- Re-verify the migration registry immediately before implementing (another child may consume 017 first).

## Runtime generations (plane 3) — in-memory truth only

- Candidate: connect with JIT secret resolution → bounded-deadline `tools/list` pagination implemented locally
  (SDK `@ai-sdk/mcp@2.0.10` does not paginate) → schema-compatibility normalization → collision detection →
  close-on-failure. A candidate NEVER publishes tools; `test` is a candidate with diagnostic-only output.
- Publication: under the manager lock, an accepted candidate atomically swaps the active generation
  (last-good retention: a failed candidate leaves the previous generation serving).
- Leases: each in-flight tool call holds a lease on its captured generation; future per-turn `tools()` reads see
  the current generation; draining generations receive no new leases; drain budget then force-close; every client
  closed exactly once (`InMemoryTransport` + `closedCount` pattern).
- Crash/restart: boot reconcile = desired state → candidates → publish; runtime generations are NEVER persisted
  or restored as executable truth. A locked secret catalog skips only the affected servers with truthful status;
  boot never bricks and never reports fake presence.
- Disable/remove/secret-clear: block new leases on the owning server's generation, then drain/close once.

## Operator API (plane 2 surface)

- `mcp.*` methods (list/get/add/edit/enable/disable/remove/test/reconnect/status-diagnostics), `roles:
  ["operator"]`, one-register-call seam, error sanitization before registry echo points.
- Writes carry `expectedConfigRevision`; conflicts return a typed conflict error with current revision
  (`POLICY_CONFLICT` exemplar). Ordinary changes require NO process restart.
- Selected tools + collision-failure isolation: one bad server/tool disables nothing else (existing per-server
  isolation preserved); ambiguous sanitized-key collisions reject those tools fail-closed.

## Home management page

- One MCP management page following the existing management-page conventions (loading/empty/validation/
  partial-failure/reconnecting/success), typed `ws-client` routes, fresh state per authenticated generation, no
  permission/config snapshot persistence in localStorage/caches. Secret fields write-only (values never echoed).

## Non-goals (frozen)

No `tools/list_changed` auto-refresh (SDK-unproven), no marketplace/prompts/resources/Apps, no provider-specific
servers, no Node-host MCP replication, no weakening of governance/Approval/secret-catalog contracts.

## Converged implementation contracts (2026-08-17)

The strict Slice 6 review found lifecycle races and truth-boundary gaps in the first implementation. The approved
convergence keeps the product design above and pins these implementation contracts:

- Desired env/header values are valid `secret-ref:` markers only. Plaintext cannot cross the Shared wire or persist in
  SQLite; `secret.set` remains the only value-carrying method.
- Every desired operation creates a process-local ownership token. Candidate publication requires the exact current
  desired object and candidate token, so a late completion cannot replace a newer revision or resurrect disabled,
  removed, secret-cleared, or shutting-down state.
- Candidate connect plus all locally paginated `tools/list` pages share one abortable deadline. Missing selected tools,
  repeated cursors, the 1,024 tool/page bound, and normalized-key collisions fail the candidate closed.
- One shared close promise owns each connected client. Generation records capture `ownerHostId`, `configRevision`, and
  secret refs; active plus draining leases remain visible, and forced close of a dispatched call reports
  `OUTCOME_UNKNOWN`.
- Secret clear examines desired, candidate, active, and draining captures before retiring affected generations. Secret
  set reloads each enabled desired server that references the changed ref.
- Transport failures are sanitized before logs, operator views, or model results. Raw connect/list/tool-call errors are
  never a product diagnostic surface.
- Home treats env/header inputs as write-only. Renaming a field or switching transport requires re-entry. Edit first
  wins the optimistic desired revision, then rotates secrets and reconnects; post-commit failure preserves the draft
  and advances its retry revision. Failed tests remain failed, and disabled servers cannot reconnect.

The executable cross-layer contract is `.trellis/spec/backend/mcp-lifecycle.md`.
