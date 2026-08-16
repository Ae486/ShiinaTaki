# Secure MCP Lifecycle — Execution Plan

> Design: `design.md`. Seams: `research/live-mcp-lifecycle-seam-map.md`. One coherent implementation wave with
> focused tests throughout; one formal check after convergence. INPUT/OUTPUT/POS headers + index.md updates on
> every change. Re-verify the migration registry (017 availability) before starting.

## Phase 1 — Desired state (migration 017 + repo)

1. `017-mcp-desired-servers.ts`: STRICT table per design; registered append-only; tests (create/seed/reopen,
   STRICT/CHECK enforcement).
2. Desired-state repo with transactional per-row `configRevision` optimistic writes (governance-repo exemplar);
   legacy `mcp-servers.json` seed only when the table is empty, boot-ordered AFTER secret migration.

## Phase 2 — Shared schemas + operator methods

3. `@taki/shared`: MCP CRUD/test/reconnect/status/diagnostic schemas (strict Zod; write-only secret fields;
   sanitized diagnostic shapes; `expectedConfigRevision` on writes) + schema tests.
4. Core `mcp.*` methods (roles operator, one-register-call seam, pre-echo error sanitization, typed
   `MCP_CONFIG_CONFLICT`-style refusal carrying current revision). Method tests incl. conflict/no-restart.

## Phase 3 — Runtime generations (the core rework)

5. Rework `mcp-manager.ts` from boot-only into the generation machine: candidate (JIT secrets → bounded-deadline
   local pagination → schema compat → collision rejection → close-on-failure), atomic publish under lock
   (last-good retention), lease capture per in-flight call, drain-budget + exactly-once close, truthful per-server
   status/diagnostics. Keep the existing governed-tool wrapper and per-turn `tools(interactive)` assembly intact.
6. `main.ts`: non-blocking boot reconcile (desired → candidates → publish) wired after secret migration; shutdown
   becomes stop-publication → drain-budget → force-close. Locked catalog → skip affected servers truthfully.
7. Unit tests: candidate/publish/last-good, lease/drain/exactly-once (`InMemoryTransport` + `closedCount`),
   in-flight call stays on captured generation while next turn sees replacement, disable/remove/secret-clear
   lease blocking, crash reconcile from desired only.

## Phase 4 — Home MCP page

8. Typed ws-client routes + one management page with loading/empty/validation/partial-failure/reconnecting/
   success states; write-only secret fields; no snapshot persistence; fresh refetch per authenticated generation.
   Reuse existing page/state conventions (see seam map §4). Desktop tests for every state.

## Phase 5 — Verification

9. Focused suites all green, then full gates: `pnpm -r typecheck`, `pnpm lint`, package suites, cargo locked +
   clippy (if Rust touched), `git diff --check`, header/index audits.
10. Real-process e2e (`withStack` incl. `restartCore`): add → test (no publish) → enable → real governed tool
    call through Approval → edit (configRevision conflict + retry) → in-flight generation retention → disable
    drains → Core restart reconciles desired truthfully → locked catalog skips only affected servers.

## Exclusions

No `tools/list_changed`, marketplace, prompts/resources, provider-specific servers, Node-host replication; no
weakening of Slice 2-5 contracts (governance, approval challenge/resume, host-control, secret catalog).

## Rollback points

Each phase is independently fail-closed: desired state is additive; the generation rework lands behind the
existing `tools()` interface so per-turn assembly keeps working mid-wave; a failed Phase 3 leaves boot-only
behavior unreachable (new manager is all-or-nothing within its tests) — if Phase 3 must roll back, revert the
manager rework commit-scope only, keeping migration + methods inert.
