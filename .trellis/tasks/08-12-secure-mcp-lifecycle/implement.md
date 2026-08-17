# Secure MCP Lifecycle — Execution Plan

> Design: `design.md`. Seams: `research/live-mcp-lifecycle-seam-map.md`. One coherent implementation wave with
> focused tests throughout; one formal check after convergence. INPUT/OUTPUT/POS headers + index.md updates on
> every change. Re-verify the migration registry (017 availability) before starting.

## Convergence status (2026-08-18)

- Phases 1-4 are implemented in the worktree: migration/repo, Shared/operator methods, runtime generations, boot
  reconcile, secret invalidation/reload, and the Home MCP page.
- The strict Slice 6 review was `request changes`. Its approved findings have been addressed with token-gated
  publication, abortable candidates and late-client cleanup, shared exactly-once close, captured secret refs,
  active/draining status, forced-close unknown outcomes, marker-only desired config, bounded discovery, and truthful
  Home editor/test behavior.
- The manager was split into `mcp-manager-state.ts`, `mcp-publication.ts`, and `mcp-client-close.ts`; this is a size and
  ownership correction inside Phase 3, not a new product surface.
- Source headers and affected folder indexes are synchronized. The reusable contract now lives in
  `.trellis/spec/backend/mcp-lifecycle.md`.
- The `jbcontext` index was rebuilt for the new files. The single formal Slice 6 check and the later owner-requested
  `[Approval C+E, Slice 6)` security review/repair are complete. Owner-manual acceptance remains unclaimed.

## Formal check result (2026-08-17)

Result: **pass-with-fixes**. The single Slice 6 check completed after the strict review repairs.

- Workspace typecheck passed for Shared, CLI, Desktop, E2E, and Core; root ESLint passed.
- Focused suites passed: Shared MCP 15, Core MCP 56 after final regressions, Desktop MCP 21.
- Full package suites passed: Shared 301, CLI 44, Desktop 407, Core 1,405 plus 1 existing skip.
- Real-process `mcp-lifecycle.e2e.test.ts` passed 3/3. It proves no-restart management, diagnostic-only test, a governed
  standard MCP tool call through Approval, revision conflict/retry, disable/enable, fresh-lineage restart reconcile,
  secret clear/locked isolation, legacy seed-once behavior, and sentinel absence from responses/logs.
- Desktop Vite production build passed (existing Live2D non-module script warnings only). Independent Node strip-only
  Core boot reached `ws server listening` with a temporary data directory.
- `git diff --check`, production header, affected `index.md`, debug-suppression, and file/function lint audits passed.
  The existing named-export public entry `packages/shared/src/index.ts` remains 325 physical lines; it is the allowed
  package entry barrel and was not split for this feature.
- The original Slice 6 product diff touched no Rust, so Cargo/Clippy were not applicable to that formal check. The
  later pre-Slice-7 security batch did touch Rust and passed the gates recorded below.

Final check fixes were limited to two lifecycle contracts: shutdown now tracks late candidate cleanup within its
global budget, and clearing a ref used only by an old draining generation no longer retires the newer active generation
for the same server. Both have focused regression tests; Core full and real-process MCP gates were rerun afterwards.

Pending owner/manual evidence: packaged Home WebView interaction, a live external MCP provider/credential round-trip,
and the parent Slice 8 two-Node convergence proof. These do not invalidate the automated Slice 6 acceptance above and
must not be recorded as passed without observation.

## Pre-Slice 7 security convergence

Before Standard Skill Lifecycle implementation starts, close the seven remaining findings from the strict
`[Approval C+E, Slice 6)` review as one compact security batch:

1. Re-evaluate the latest Host floor and emit the allowed audit entry before an approved resume executes.
2. Block sensitive `secret.set` input from every generic CLI call path; retain the stdin-only command.
3. Make Windows master-key first creation cross-process atomic and non-overwriting.
4. Reject normalized secret-ref identity collisions before migration mutates the catalog or source file.
5. Retire every pre-execution Host challenge at deadline, including non-cooperative capability kinds.
6. Clear capability deadline timers on every terminal settlement.
7. Restore the historical capability-response diff quality gate.

The batch receives focused regression tests for every finding and one final cross-layer check covering Approval,
Host-control, CLI, Secret Catalog, MCP compatibility, Rust gates, headers/indexes, and `git diff --check`. Preserve the
already-verified Slice 6 behavior and do not enter Slice 7 until the check passes. Platform-only/manual evidence remains
explicitly unverified.

Result (2026-08-18): **passed after verified repairs**. All seven findings were fixed. The final review additionally
closed a session-local Windows mutex scope error, non-atomic device identity creation, strict-Clippy ordering failure,
missing MCP index entry, oversized contract headers, a production decision-writer visibility regression, and a
non-Windows Rust test cfg mismatch. Final evidence: Shared 301, CLI 47, Desktop 407, Core 1,409 plus 1 existing skip;
Approval/Secret/MCP real-process E2E 8; Desktop production build; Rust 170 library plus 7 helper tests; strict locked
Clippy; Core strip-only boot; header/index audits; and `git diff --check`. Live cross-session Credential Manager
contention/persistence, packaged Home interaction, external MCP credentials, Linux systemd credentials, and owner-only
manual acceptance remain unverified.

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
