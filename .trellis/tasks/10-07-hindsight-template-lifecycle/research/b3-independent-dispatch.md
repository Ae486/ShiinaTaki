# B3 and whole-Stage-5B independent review dispatch

Root prepared this dispatch during the approved B3 implementation on 2026-10-09. It does not transfer source
ownership until the named implementation owner releases its complete self-check/source handoff. The owner has
authorized completion of all Stage 5B and delegated scheduling; stop before 5C. Reuse the current task and agents.

## Entry and scheduling

- Read `review-plan.md`, `b3-dispatch-plan.md`, `b3-shared-wire-contract.md`, the released implementation report
  and its source manifest. B1 and B2 independent reports remain evidence for unchanged behavior; they are not a
  substitute for reviewing all current B1-B3 source in the assigned layer. Preserve the W9, 5A and B2 fixes.
- Root may start a released layer's static review while another implementation owner works in disjoint files.
  Only root transfers write ownership and grants the single heavy-check slot. Vitest has at most two workers.
  Tests, lint, typechecks, builds and canonical generation are serial. Do not start nested agents.
- Review actual source and command outputs, including untracked source, not just the implementer's narrative.
  Record real argv, exit code, source/dependency identity, fixture boundaries and cleanup. Keep every failed run.
  Reuse unchanged passing evidence; rerun affected paths after a fix and do not add overlapping test counts.
- All providers are deterministic fakes or fail-on-call traps. Use the current isolated Native runner and clean
  environment. Never load original instances, databases, credentials, model services or a real `.env`.

## Disjoint review and fix ownership

| Reviewer scope | Owned after explicit release | Read-only boundaries |
| --- | --- | --- |
| Native | B1-B3 Native lifecycle, extraction/provenance, backup observer/API/CLI, same-connection proof/COPY, compatibility/OpenAPI and generated clients; Native documentation and `hindsight-template-lifecycle.md`. | Core/Shared/Desktop sources. Core sends lifecycle-spec amendments to this sole writer. |
| Core/Shared | B1-B3 Shared protocol/hash fixtures and entry exports, Core composition/storage/runtime/operations, backup capture/admit/verify/restore/preflight, healthy transition/W9 integration and necessary tests/indexes; backend backup/transition specs. | Native/generated/Desktop production; original seven trusted-label consumer files remain accepted unless root coordinates a concrete fix. |
| Home | Template WS adapter/composition, generic injected formatter seam, Operations template controller/hook/components/fixtures and frontend specs; actual operator-client and browser checks. | Shared/Core/Native producers. Send contract defects to root and the owning reviewer. |

Root owns task metadata, combined source reconciliation, acceptance and `docs/HANDOFF.md`. Other work and
preexisting uncommitted changes coexist. Never revert another owner's edits or rewrite historical migrations.
No new dependency, commit, push, reset, rebase, finish or archive is authorized.

## Required connected dimensions

| Boundary | Independent evidence required |
| --- | --- |
| Strict wire and compatibility | v1 bytes/semantics unchanged; distinct strict v2; complete selected original Apply and receipt commitments; cross-language hash vectors; all eleven domains; duplicate/extra/missing/version rejection; compact input cap, per-Apply cap, observation overhead and 256-Bank response/manifest bounds. Only backup calls get the larger response limit. |
| Copied Core and Native history | Attestation comes from the actual copied SQLite, with validated defaults/history/publication/hold and exact incarnation. Independent complete Native receipt inventory detects undeclared no-op or refresh-only receipts and pre-Core/post-Native combinations. Unknown proof cannot become empty history; an explicit removed overlay remains selected `none`. |
| Actual observation and routes | Route c joins its actual authorized resolver to the same connection's proof/COPY. Managed route b uses the actual authenticated observation route and independently compares its own transaction's inventory/database facets. Missing context, fallback, stale facet, nonce/request/schema/target drift and failing validators refuse. No CLI environment is substituted for running service config. |
| Four pair consumers and restore | Exercise real capture, route-b admit, verification and D91 preflight. Reconstruct historical copied identity at each applicable boundary; ordinary Native-ahead memory/generated-content progress stays valid when template state is equal. Physical customized/removed restores preserve receipts, child markers and label sidecar. Current config mismatch refuses readiness without corrupting historical verification. |
| Healthy/W9 and W6 | Exact persisted template association to real fenced W2 evidence; final synchronous template/hold plus live lease revalidation after read-back; transaction rollback on drift; exact-generation ownership. W6 remains offline and quarantines late work, with no observer dependency or automatic old-branch revival. |
| Home intent and consequences | Explicit value/inherit/suppress are preserved, including equal-to-template values; full user resources survive removal; no preview with unsaved resources; each Bank's actual details/deletion/provider consequences are reviewed. Defaults and per-Bank changes stay distinct. No client-inferred recovery or Native requests. |
| Real operator lifetime | Actual registry/WS/controller/DOM and one browser scenario cover one apply, partial/lost reply, original operation identity, two observers, reconnect, stale preview/detail, binding-only recovery, derived stale/unavailable and sanitized errors including subscription failure. Reads never apply/refresh; reconnect retains draft but retires preview, without polling or write replay. |
| Whole source and quality | Review all current B1-B3 paths and preserved W9/5A boundaries; inspect headers/indexes/specs and narrow 625-line Shared export allowance. Consolidate workspace types, root lint, serial workspace tests, Desktop build, applicable Native checks and canonical generation/SDK contracts. Record platform or installed/manual limitations accurately. |

Configuration observation is an authoritative point-in-time input, not a fictional revision or proof against
undetected ABA. Its source-context digest must use actual context and remain stable across a compatible process
restart. Historical integrity and current-target readiness are different verdicts. D91 is an explicit stopped-writer
operator preflight, not automatic restore/startup orchestration. Stage 6 retains installed/original/manual checks.

## Release

Each checker reports findings, fixes, validation scope and actual limits, then freezes its final owned source plus
relevant dependency inputs and explicitly releases ownership and the heavy slot. Cross-layer issues remain open
until both sides agree and affected verification uses the final sources. Root matches all released manifests and
evidence before marking the Stage 5B automatic criteria. A scoped PASS alone never accepts the whole stage.
