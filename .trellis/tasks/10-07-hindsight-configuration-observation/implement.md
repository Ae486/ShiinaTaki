# Stage 5 configuration observation execution plan

Acceptance: independent full-slice PASS on 2026-10-07; R1/R2 closed, final source identities verified,
and all source/generation/test ownership released. See `research/independent-check.md`.
The full Core baseline preceded R1; final acceptance combines that baseline with the affected 78-test suite,
independent 17-test rerun, final types/lint and actual boot. No final-source full Core rerun is claimed.
Original/installed/manual acceptance and Git/Trellis archival remain separate.

Status: approved for execution on 2026-10-07; the owner accepted proceeding with the presented Stage 5 plan.
Existing B7 is the parent; Stage 4 W9 is an accepted predecessor. The owner delegates implementation/check
cadence to the leader according to actual complexity. One implementer owns Native/Shared/Core; after the strict
Shared contract stabilized, a second implementer was assigned disjoint Home/frontend files. One independent
full-slice checker follows both source releases. Read-only researchers may prepare later slices; they must not
edit shared production sources or contend with implementation tests.

## Gates before implementation

- [x] Current-source residual Stage 5 audit and focused Native authorization/runtime-producer research complete.
- [x] Stage 4 W9 implementation and independent review passed; preserved full-run/scoped-timeout evidence is explicit.
- [x] PRD/design/execution artifacts identify API-only coverage, exact grants, safe schema and compatibility limits.
- [x] Owner approves administrator-opt-in model-identity disclosure and this bounded slice through the presented Stage 5 plan.
- [x] Both curated context manifests validated (18 entries each); PRD/design/execution artifacts reviewed before activation.

## Serial implementation waves

1. **Native producer, grant and wire contract.** Verify Native workspace/HEAD/dirty baseline and local instructions.
   Implement default-deny TenantExtension hook, built-in exact-grant parsing, genuine API-engine collector/session
   identity, strict model module and authenticated compatibility-router route. Use pure safe projection plus read-only
   Bank identity lookup. Preserve existing config/health responses. Add denial/cross-namespace/sentinel/zero-effect
   tests before exposing the endpoint. Own Native engine/router/tenant/model/test/index files only in this wave.
2. **Shared/Core integration and compatibility.** Define the one strict Shared wire/read-model schema and exports,
   bounded client method, operator-only server registration, target mapping, identity/freshness service and in-memory
   status. Coordinate exact old/new build gates and mandatory transition contracts; run the repository's canonical
   generated-contract pipeline where required. One owner controls Shared exports, registry/boot and version changes.
   Prove wrong-role/nonce/identity, configuration-change races, concurrent observers, expiry/restart and optionality.
3. **Home vertical completion.** Reuse existing connection/hooks/components for one selected Bank. Add desired-versus-
   observed API profiles, visible partial coverage and explicit refresh states, while keeping health/readiness separate.
   Own the focused Operations/Settings card/controller/client tests and relevant indexes. No browser-local persistence.
   After the Shared schema is stable, this wave may run alongside Core integration under explicit disjoint ownership.
   The Native/Core owner coordinates consolidated heavy tests after Home release; Home runs only focused tests meanwhile.
4. **Consolidated independent check.** Dispatch one `trellis-check` over the complete Native/Shared/Core/Home slice,
   including authorization, confidentiality, exact producer, stale reads, compatibility and prior-operation regression.
   Correct actual findings and recheck their impact. No arbitrary per-file delegation or speculative performance work.

Use focused implementation checks at Native and Core integration boundaries, then consolidated type/lint/package
checks and an independent end-to-end contract review. Stage 5A receives its own check because authentication,
confidentiality, configuration races and cross-version compatibility are substantive risks. Do not defer its
acceptance until 5B/5C. Reassess later slice grouping once their concrete designs and source ownership are known.

## Verification and evidence

- Native tests: no-auth/wrong key/no grant/custom-hook error, exact namespace/Bank grant, allowed-Bank restriction,
  ordinary Bank validator refusal, confidentiality sentinels, actual constructor objects and all unknown topologies.
  Prove no provider/initializer calls, Bank creation or replication initialization under a read-only fixture.
- Shared/Core: strict schemas and body bound, normal-role enforcement through actual dispatch, desired/null comparison,
  two observers, response ordering, connection/secret/epoch/session changes, identity mismatch, expiry and restart.
- Compatibility: both old/new admitted build sets, preserved mandatory contracts, old preview refusal after a real
  manifest change, successful fresh proof, and existing setup/transition behavior with observation unsupported/denied.
- Home: loading, observed-partial, mismatch, denied, unsupported, unavailable, stale, reconnect/remount and failed-refresh
  states over the real controller/client. Keep a separate explicit connectivity-health action; never call a model on refresh.
- Inspect actual package scripts before execution. Run `pnpm typecheck`, `pnpm lint`, affected Shared/Core/Desktop
  suites at at most two Vitest workers, relevant Native contract/type/lint checks and Desktop build. Use owned disposable
  fixtures and mock/model traps; no actual Native model or original data. Do not install new dependencies implicitly.
- Read current Native guidelines to determine canonical API/SDK generation commands and validate every generated touch.
  Avoid broad Native platform suites known to require unsupported environments; record exact supported scope and limits.
- Once gates pass, reuse unchanged exact-source results. Repeat/broaden only for changed behavior, a new failure or an
  unresolved integration concern; preserve failed attempts and real exit codes in task-owned records.
- Record final source/artifact identities, actual checks, teardown and unperformed original/manual boundaries. No secret
  values or arbitrary process command lines in evidence. Do not call partial coverage complete setup/model acceptance.

## Deployment, rollback and completion

No database migration or new secret type is planned. Native grants are deployment configuration; their parser fails
closed. Old build support remains explicit; the new feature is optional and must not become a setup/authority gate.
Real service deployment, changing an original instance's grants/config, paid calls and authority replacement require
their own execution scope; they are not part of fixture-only implementation.

Revoking grants stops new disclosure; old disclosed knowledge cannot be revoked. Do not roll back by deleting data,
altering old receipts, forcing config reversal or downgrading schemas. Preserve stopped fixture ownership/teardown.

After independent pass, update executable specs and acceptance/status records and report remaining Stage 5/6 work.
No commit, push, finish or archive is included without separate owner instruction. A denied disclosure decision keeps
this child planning and moves the next planning focus to the accepted template lifecycle; do not implement a substitute
using ordinary Bank GET/health or operator-authored model evidence.
