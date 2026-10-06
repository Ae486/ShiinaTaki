# W4 independent check

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.

**Verdict: PASS for the complete W4 scope, under the owner's explicit cohesive-function line-count amendment.**
The raw lint command still exits 1 for exactly five approved length diagnostics; it is not a clean lint pass.
Five independently reproduced behavioral defects were repaired, eight regression cases were added, and the affected
checks passed. W5-W8 and product/manual acceptance remain separate gates.

## Identity, ownership and evidence

- Checker: `/root/w4_check`; parent session `session:codex_01a0ed15-10d0-7802-90a1-48c5d50ec0fc`.
- Actual workspace: `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
  The explicit assignment is authoritative despite the empty legacy `.current-task`. No T4 worktree was used.
- Native dependency: `H:/hindsight`, branch `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
  Parent independently rechecked all 349 recorded native paths: zero missing or changed. This report relies on that
  current parent preservation check; the checker did not rerun native/model journeys or edit Native sources.
- Reviewed the actual W4 production paths against PRD/design/implement, final W0-W3 reports, W4 delivery/check brief,
  curated context and executable specs. Historical/frontend context was read for applicable contracts; this is not
  a claim of exhaustive line review of every historical document.
- All existing edits were retained. No new dependency, agent dispatch, commit/push/reset/rebase, original-data or
  authority replacement, real-corpus extraction, finish/archive or W5 implementation occurred.

## Findings (fixed)

### F1 — Completed live ingestion witnesses bypassed original source validation

- File: `packages/core/src/db/memory-transition-custody.ts`.
- Issue: a live witness with `span_state='complete'` bypassed the completed ingestion span's source membership/hash
  and epoch ancestry checks. A rewritten completed source could be accepted before Timeline compaction, both when
  collecting source custody and verifying transferred target custody.
- Fix: validate completed spans even while Timeline rows remain, bind the actual producer-derived span identity,
  provider/lineage, exact seq/entry/digest and allowed epoch ancestry; require the witness's own span when available.
  Reuse `canonicalIngestionIdentity` and `hindsightIngestionIdentity` instead of a new identity convention.
- Evidence: source/target completed-membership corruption with a recomputed source hash now refuses. Actual partial
  ingestion, completed compaction and legitimate user-only retraction continue to pass.

### F2 — A missing finalized group's final member could disappear before proof

- File: `packages/core/src/db/memory-transition-custody.ts`.
- Issue: removing the last member from a finalized group could turn it into an empty group, subsequently filtered
  from the outstanding-custody inventory without refusal.
- Fix: validate its actual final member against `finalized_through_seq` before filtering consumed groups.
- Evidence: the added pre-proof deletion case failed against the delivered implementation and passes after repair.
  F1/F2 regression file: `packages/core/src/db/memory-transition-custody.test.ts`.

### F3 — Cross-Bank capture outlived its expired admission owner

- Files: `packages/core/src/memory/hindsight/hindsight-capture-sync.ts`,
  `hindsight-runtime-bank-service.ts`, `hindsight-runtime-lifetime.test.ts` in the same directory.
- Issue: `syncBanks()` could continue after its Run admission budget elapsed while inheriting the completed outer
  capture owner. The first Bank could finish, but the second Bank could no longer enter the work fence.
- Fix: the existing Bank service owns and tracks the entire capture sequence before the caller races its budget.
  Per-Bank descendants inherit that still-live owner, and drain/shutdown join the complete sequence.
- Evidence: a real started subsystem, paused background scheduler, 50 ms admission budget and independently held
  Global/Character calls show Character proceeds after caller return and drain waits for Character. The first probe
  was affected by the ordinary scheduler; its failed output is retained separately from the corrected real red case.

### F4 — Valid Native outcome JSON could satisfy another Bank's stored obligation

- Files: `packages/core/src/db/memory-transition-native-outcome.ts` and its test.
- Issue: the reader fetched Bank B's row but validated Bank A's otherwise valid outcome using the payload's own Bank
  identity. The same transition's other Bank could stand in for activation or abort-release evidence.
- Fix: shared `readStoredOutcome` joins payload Bank and transition identity to the exact queried storage key.
  Readiness, release and idempotent outcome writes all use this check.
- Evidence: committed and pre-COMMIT-abort variants both failed before repair and now reject the substitution.

### F5 — Source/target no-effect classification skipped Pending storage integrity

- Files: `packages/core/src/db/memory-transition-pending-refusal.ts`, `memory-transition-source-disposition.ts`,
  `memory-transition-effect-repo.ts`, and `memory-transition-source-disposition.test.ts`.
- Issue: both classifiers parsed `state_json` without the original Pending reader's key, intent hash, version/phase
  and native-dispatch validation. A JSON operationId plus recomputed intentHash could disagree with the queried row
  and still certify the original operation had no effect.
- Fix: `readTransitionPendingState` delegates to `readPendingMemory`. It strips only storage-only `sequence` through
  the existing state schema, retaining the prior immutable transition-evidence hash format. Both classifiers reuse it.
- Evidence: source and target forged-Pending-key cases failed before repair and now refuse. Factual non-dispatch,
  zero-effect cancellation, partial/unknown ownership and actual target receipt cases remain passing.

### F6 — Current quality and runtime guidance lagged the inherited implementation

- Files: `CLAUDE.md`, `.trellis/spec/backend/quality-guidelines.md`,
  `canonical-local-memory-runtime.md`, `memory-transitions.md`, `memory-transition-publication.md`, and touched indexes.
- Issue: quality guidance still stated a 520-line Shared entry allowance while the existing config narrowly allows
  540. The Local caveat and transition phase description also omitted current W4 behavior.
- Fix: document actual 540 scope and retained source-bearing named-export AST guards; describe fenced new-Character
  Bank refusal/final coverage obligations and W3/W4 ownership; record F1-F5 executable contracts and module summaries.
  `eslint.config.js` itself was preserved byte-for-byte.

## Complete W4 verification coverage

| Boundary | Independently checked behavior |
| --- | --- |
| Atomic publication | `publishMemoryTransition` validates current proof/candidate/inventory/configuration/custody/queue inside one synchronous outer SQLite transaction; representation installation/read-back, epoch selection, receipt and marker are in that transaction. Injected write/COMMIT and stale-boundary tests retain the source. |
| Migration and historical receipts | Migration 054 adds the explicit transition marker; original first Local/B4 receipt paths remain separate. Fresh/upgrade/reopen and immutable-row guards were exercised. All 55 historical migration source files numbered 001-053 match their pre-W4-map or HEAD baselines. |
| Boot/recovery | Marker/publication/epoch/candidate/proof/mapping/custody corruption refuses before constructors. Lost replies and failed target binding keep the selected target and recover without another promotion. First-activation guards and ordinary expired-baseline refusal remain covered. |
| Actual runtime lifetime | Two provider cycles use four genuine Core W4 receipts and started production constructors/schedulers. Old references stay retired; constructor/start failure is repaired on the same target. Both binding disposal paths and shutdown during drain are exercised. |
| Writer ownership | Local raw/engine/source/policy/retention/ingestion and Hindsight foreground/manual/background paths share actual fences. Imported new-Character capture and direct assembly while fenced do not create an implicit Bank. Detached nested work and the expired-budget multi-Bank case retain exact ownership. |
| Original callers and queue | Actual canonical tool entrypoints durably admit before the distinct queued ACK; original provenance survives, capacity is retryable, cutoff is terminal and refused calls do not insert. Genuine target receipts reconcile effect-before-ACK; unknown retains its original request and blocks later sequence work. |
| Primary custody | Actual append/finalize, late target commit, reopen, partial consumption, compaction, user-only retraction and corruption cases preserve exact membership. F1/F2 close missing-original-proof paths rather than weakening compaction guards. |
| Awaiting Source/Native outcomes | Candidate Source artifacts join original Pending/parent/custody proof. Partial or foreign evidence cannot become no-effect success. F4 verifies per-Bank finalization keys; F5 uses the original durable Pending validator. |

Native envelopes in these Core tests are deterministic fixtures. Core publication and effect producers are genuine;
this is not actual Native maintenance/resolve, real-corpus roundtrip or emergency outage acceptance.

## Verification

All Vitest groups ran sequentially, each with `--maxWorkers=2 --reporter=dot`. Counts overlap and must not be added.
Node was `v24.18.0`; pnpm was `10.22.0`. Raw failures are preserved, never relabeled as passing runs.

| Check / session | Actual result | Evidence |
| --- | --- | --- |
| Initial root lint / 46238 | Exit 1; the same five authorized length diagnostics | Tool trace; final log below |
| Initial workspace types / 24599 | Exit 0; all five workspaces | Tool trace |
| F1/F2 red / 10096 | Exit 1; 3 FAIL, 9 PASS | Tool trace |
| F1/F2 green / 90166 | Exit 0; 1 file, 12 PASS | Tool trace; also final runtime group |
| Initial targeted W4 Core / 4342 | Exit 0; 27 files, 194 PASS; before F3-F5 | `w4-independent-core.log`; full selector list in tool trace |
| F3 first probe / 76102 | Exit 1; scheduler interference in the probe | `w4-independent-detached-red.log` |
| Corrected F3 red / 38139 | Exit 1; 1 FAIL, 2 filtered | `w4-independent-detached-red2.log` |
| F3 green / 32253 | Exit 0; 3 files, 18 PASS | `w4-independent-detached-green.log` |
| F4 red / 31819 | Exit 1; 2 FAIL, 2 filtered | `w4-independent-outcome-key-red.log` |
| F4 green / 57747 | Exit 0; 3 files, 9 PASS | `w4-independent-outcome-key-green.log` |
| F5 red / 25954 | Exit 1; 2 FAIL, 3 filtered | `w4-independent-pending-key-red.log` |
| F5 green / 2927 | Exit 0; 3 files, 13 PASS | `w4-independent-pending-key-green.log` |
| Final `pnpm -r typecheck` / 78355 | Exit 0; Shared, Core, Desktop, CLI, E2E | `w4-independent-typecheck.log` |
| Final `pnpm lint` / 12710 | Exit 1; exactly five approved length errors, no other diagnostics | `w4-independent-lint.log` |
| Shared affected contracts | Exit 0; 4 files, 38 PASS | `w4-independent-shared.log` |
| Core callers/operations / 66254 | Exit 0; 7 files, 51 PASS | `w4-independent-callers.log` |
| Final affected runtime/publication / 55091 | Exit 0; 8 files, 71 PASS | `w4-independent-final-runtime.log` |
| Node strip-only Core process smoke | Exit 0; Legacy and genuine B2-produced Local boot/WS/graceful stop/reopen | `w4-independent-boot-status.log`, script below |
| Task validate | Exit 0; 34 implement / 37 check entries | `python .trellis/scripts/task.py validate .trellis/tasks/09-29-hindsight-transitions-emergency` |
| Diff checks | Unstaged and cached both exit 0 | `git diff --check`; `git diff --cached --check` |
| Source/header/index/UTF-8 audit | Exit 0; 94 paths; no issue | `w4-checker-source-audit.py`, `w4-checker-source-hashes.json` |

Actual final lint exceptions, as permitted by the owner:

| Function | Lines / limit |
| --- | --- |
| `createHindsightRuntimeBinding` | 55 / 50 |
| `composeMemoryRuntime` | 51 / 50 |
| `selectMemoryRuntime` | 55 / 50 |
| `createMemoryTransitionRuntime` | 51 / 50 |
| Earlier W3 `projectTransitionLocalBank` | 51 / 50 |

No suppression or global rule relaxation was introduced. Diff output contains existing CRLF normalization notices
for prior task/deferred-decision documents; both checks still exit 0.

### Reproducible affected test commands

Run from `H:/TakiAgent`. Each command below appends `--maxWorkers=2 --reporter=dot`; groups never overlap.

```powershell
pnpm --filter @taki/core exec vitest run src/db/memory-transition-custody.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-runtime-lifetime.test.ts src/memory/hindsight/hindsight-capture-sync.test.ts src/memory/hindsight/hindsight-runtime-bank-service.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/core exec vitest run src/db/memory-transition-native-outcome.test.ts src/db/memory-transition-abort.test.ts src/memory/transitions/transition-runtime-recovery.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/core exec vitest run src/db/memory-transition-source-disposition.test.ts src/db/memory-transition-effect-repo.test.ts src/memory/transitions/transition-intent-executor.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/shared exec vitest run src/memory-transition-schema.test.ts src/memory-provider-operation-schema.test.ts src/memory-operation-schema.test.ts src/error-code-schema.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-provider.test.ts src/memory/transitions/transition-intent-executor.test.ts src/memory/operations/memory-operation-service.test.ts src/memory/operations/memory-operation-kind-transition.test.ts src/memory/operations/memory-authority-status.test.ts src/memory/canonical-tools/canonical-memory-tools.test.ts src/memory/memory-coordinator.test.ts src/db/memory-transition-queue-repo.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/core exec vitest run src/db/memory-transition-custody.test.ts src/db/memory-transition-publication.test.ts src/memory/transitions/transition-runtime.test.ts src/memory/transitions/transition-runtime-recovery.test.ts src/memory/hindsight/hindsight-runtime-lifetime.test.ts src/memory/hindsight/hindsight-capture-sync.test.ts src/memory/hindsight/hindsight-runtime-bank-service.test.ts src/memory/hindsight-runtime-composition.test.ts --maxWorkers=2 --reporter=dot
```

The recorded callers command contains `transition-provider.test.ts`, which is not an existing test file; Vitest
selected seven real files, not eight. Queued-provider behavior is exercised through actual canonical tools in
`transition-intent-executor.test.ts`. The counts above are the actual Vitest counts.

### Independent production process smoke

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w4-independent-boot.mjs
```

The retained harness imports actual `main.ts` in a child under native Node type stripping, using an allowlisted
environment, isolated data roots, a nondefault loopback port, and an owned HTTP trap as the fake model endpoint.
It does not load `.env.local` or original settings. The Local database is made from one synthetic Markdown entry
through real B2 snapshot/prepare/activate producers; no fake historical activation receipt is inserted.

Both Legacy and Local authenticate an actual WebSocket operator and read `memory.authority.status` with
`available=true`. The child emits SIGINT to the actual registered shutdown handler, exits 0, and its database then
reopens with the same selection and `PRAGMA integrity_check='ok'`. The model trap receives zero requests.
The final run's data/logs/result are under:

`.trellis/.runtime/w4-independent-boot/792b6a9f-8b5c-4345-a956-de21022ae8c8/`.

An earlier basic WebSocket/open-close version also passed (`w4-independent-boot.log`); the final run adds the actual
authenticated runtime-availability assertion. This process smoke does not claim an external Hindsight boot; started
Hindsight lifecycle and repeated receipt binding are exercised by the isolated production-composition tests above.

## Source preservation and exact handoff

`w4-checker-source-hashes.json` covers the original 89 delivered paths plus five extra current-scope paths. Fourteen
delivered files changed during checking; four extra files were repaired. The fifth extra is unchanged `eslint.config.js`.
All covered files are valid UTF-8 without BOM; production module headers and owning directory indexes are present.
The checker manifest SHA-256 is `8e9474814dcd503b30922576c657038ba88d8fdb19ee46f127c27dc26ee89915`.

Preserved immutable evidence:

| Artifact | SHA-256 |
| --- | --- |
| Original W4 delivery manifest | `c11e7015dd8992c0689941f98b0f75a06754d5adbf5dd1547924673c7d7a6f28` |
| Original W3 manifest | `998edcd67c06757f9f400ce4d17a02dcc63f7456f3607e2f992be3f674ee5851` |
| Pre-W4 baseline map | `1cd5cf124305fb12e3323b3039a1dfe8440abd9f58516a634ef0f4c8c7d1ac75` |
| Preserved ESLint config | `9821c5c024c5ed20ce6bded27de5ba13accf36a1f151b331e9386cd1b0696e86` |

Use `w4-checker-source-audit.py` to reproduce the checker inventory. Do not run the old W4 audit to overwrite the
original delivery manifest. The current checker hashes are the new source anchor, not a reconstructed live pre-W4 snapshot.

## W5/W6 consumer contract and remaining boundaries

- Use the production `composeMemoryRuntime(...).transitions` surface. W1 still owns admission/attempt/cutoff phases;
  `quiesce` drains the actual live source, and `proof`/W1 proof persistence precede `publish`.
- Configuration/inventory revision is the real connection-state revision; inventory hash covers every raw Bank setup
  column. Include every current Timeline/custody/Local/Block Character and actual verified setup rows for new scopes.
- W3 supplies complete final candidate/baseline/native proof. Core COMMIT is the exact W4 publication receipt, never a
  candidate, marker-shaped DTO or independently inserted receipt. Reread the lease/attempt after publication.
- W5 resolves Native outside SQLite and stores each actual Bank outcome with `nativeOutcome`. All Hindsight activation
  outcomes are required before `bind`/queued execution; `nativeRelease` independently proves every final release.
  Local target availability alone does not mean the overall Native retirement/release operation is complete.
- Binding failure retains the selected target/custody; retry `bind` against the same receipt. `executeIntents` uses fresh
  target contexts and genuine target receipts. Unknown retains the original Pending/parent request and blocks sequence.
- Pre-COMMIT recovery requires positive all-Bank abort outcomes, `abort`, then `resumeSource`; no timeout/error permits
  reopening old writers. Shutdown joins active execution and failed/retired drafts before database close.
- W6 owns the distinct offline incident seal and uncertainty path. Healthy Source/Native/Pending proof checks must not
  be relaxed to implement emergency takeover.

## Findings (not fixed)

No unresolved behavioral defect remains within the checked W4 scope. The exact historical author/wave of the inherited
ESLint 540 allowance cannot be established from the available manifests; that attribution gap is explicitly retained.
Its current narrow behavior is checked and documented, and no historical ownership evidence was rewritten.

W5 actual Native maintenance/resolve and copied-corpus healthy roundtrip, W6 emergency, W7 Home, W8 final acceptance,
owner/manual criteria and original-environment authority replacement have not been marked passed by this check.
