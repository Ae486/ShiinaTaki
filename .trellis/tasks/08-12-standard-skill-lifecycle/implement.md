# Standard Skill Lifecycle - Implementation Plan

## Batch policy

Implement Slice 7 as one compact batch followed by one formal full-scope check. Focused tests run continuously inside
the batch; do not split the same vertical into repeated implement/check cycles. Before production edits and before Git
integration, recheck whether `main` advanced and semantically merge it if required.

## 1. Shared contract and durable sidecar

- [x] Add strict Skill lifecycle schemas, bounded method/refusal/status vocabularies, tests, named exports, and Shared
      folder index updates.
- [x] Add migration 018, table/index tests, explicit migration registry entry, and migration folder index updates.
- [x] Implement the Zod-parsed Skill package repository with optimistic revisions, active-name uniqueness, rejected
      visibility, restart/reopen coverage, and sanitized source/failure fields.

Focused gate:

```powershell
pnpm --filter @taki/shared test -- skill-lifecycle-schema
pnpm --filter @taki/core test -- 018-skill-packages skill-package-repo
```

## 2. Safe package pipeline and runtime catalog

- [x] Install only the minimum maintained YAML/ZIP dependencies required by the design, using pnpm and verifying the
      installed version's types/API before use.
- [x] Extract/reuse one domain-neutral package-path guard without changing existing character archive semantics.
- [x] Implement bounded directory and lazy ZIP enumeration, link/special-file rejection, staging/quarantine/published
      roots, full safe YAML validation, structural scan, deterministic hash, and atomic content publication.
- [x] Implement `SkillCatalogManager` candidate/publication/generation/read-lease/retirement/GC behavior with
      last-good retention and tamper detection.
- [x] Implement legacy one-time seed and explicit reconcile over the same validation pipeline.
- [x] Replace static JSON state/scanner boot wiring with the repository/lifecycle manager. Keep legacy files untouched
      and seed-only; preserve current valid Skill behavior.

Focused gate:

```powershell
pnpm --filter @taki/core test -- skill-package skill-catalog skill-import skill-reconcile skill-legacy
```

## 3. Agent loading and operator lifecycle

- [x] Refactor the loader to use catalog snapshots; preserve `load_skill` and return revision/support inventory.
- [x] Add confined `read_skill_resource` through the existing `skill.load` / `skill-load` Governance identity.
- [x] Add the lifecycle service and one operator-only `registerSkillMethods` seam with conflict/refusal sanitization.
- [x] Wire boot reconcile and methods once in `main.ts`; avoid Skill-specific changes to the generic Agent loop.
- [x] Add focused governance, method-role, mutation-race, structured-error, and restart tests.

Focused gate:

```powershell
pnpm --filter @taki/core test -- load-skill-tool read-skill-resource skill-methods skill-lifecycle-service
```

## 4. Home Skills product surface

- [x] Add typed `WsClient` Skill methods with Shared result parsing.
- [x] Add the page controller/state/hook with current-generation-only reads, serialized writes, conflict refetch, no
      replay, and no persisted cache.
- [x] Add ZIP and directory pickers, active/rejected cards, inspect, enable/disable, replace, reconcile, and two-step
      removal with complete loading/empty/error/partial states.
- [x] Register the page and repo-native Skill icon; update navigation tests and every touched folder `index.md`.
- [x] Test source-size refusal, controller races, page actions/states, schema boundaries, and no-cache/no-secret/path
      persistence.

Focused gate:

```powershell
pnpm --filter @taki/desktop test -- skill
pnpm --filter @taki/desktop typecheck
```

## 5. Product proof and convergence

- [x] Add one real-process harness that starts Core in a temporary data root, imports a Skill after boot through
      operator WS, inspects/enables/disables/replaces/removes/reconciles it, restarts Core, and verifies durable truth.
- [x] Prove the real loader/resource tools against an enabled imported package in focused Core integration tests.
- [x] Update backend/frontend executable specs for the shipped Skill lifecycle contract.
- [x] Update source headers, directory indexes, `docs/HANDOFF.md`, `docs/ZCODE-HANDOFF.md` where still useful, and the
      developer journal. Do not claim packaged WebView/manual AC without running it.

## 6. Single formal check

Run one xhigh-effort `trellis-check` over the complete Slice 7 diff. It must review requirements and security boundaries,
not merely run commands. Only fix findings after independently confirming they are real.

Required gates (adapt command filters only to actual package script names):

```powershell
pnpm --filter @taki/shared test
pnpm --filter @taki/core test
pnpm --filter @taki/desktop test
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @taki/desktop build
git diff --check
```

Run a real strip-only Core boot with a temporary `TAKI_DATA_DIR` and nonstandard port. Rust is not expected to change;
if it does, also run locked all-target Rust tests and strict Clippy. Record environmental or manual gaps explicitly.

### Verification record

- Initial xhigh formal review returned `Not approved`; the Leader independently confirmed every actionable finding,
  repaired the implementation, and reran focused checks. A bounded post-repair xhigh recheck was attempted twice through
  the existing check agent, but the agent service returned HTTP 429 both times; no second formal-agent approval is claimed.
  The Leader completed a local full-scope audit of the repaired snapshot instead.
- Focused gates passed: Shared Skill schemas (5 tests), Core Skill suites (59 tests before the ZIP guard addition and
  34 focused tests after the final storage/ZIP changes), Desktop Skill suites (10 tests), the exact-duplicate ZIP
  regression (16/16 source tests), workspace typecheck, and root lint.
- Full gates passed: Shared 306, CLI 47, Desktop 417, Core 1,461 plus 1 existing skip; full E2E 32 passed/6 skipped;
  Desktop production build; independent Core strip-only boot; and the real-process Skill lifecycle E2E.
- Manual residuals: packaged Home WebView/file-picker interaction, real external provider credentials, two-Node Host
  convergence, and owner-only acceptance checks remain unclaimed. No script is executed by the Skill lifecycle.

## Rollback points

- Shared/migration failure: no production method wiring; remove only Slice 7 additions.
- Import/catalog failure: keep old static boot path until replacement behavior and legacy seed tests pass.
- Home failure: backend remains operator-callable; do not call the product complete until the page and build pass.
- Runtime regression: SQLite/published content remains durable; disable new method registration and rebuild catalog from
  verified rows. Never mutate or delete the legacy source tree as rollback.
