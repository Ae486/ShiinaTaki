# P1-AB — Template identity guard (wave B)

## 1. Outcome

**BLOCKED on the explicitly reserved template-owner boundary. Analysis and a red cost regression are complete; the production optimization is NOT implemented.** The smallest coherent root fix needs a cheap current-template identity reader owned by `template-lifecycle/**`. That API does not currently exist. I stopped before editing that directory, Shared, production source or a spec that would declare the unimplemented contract. This follows the wave B Ownership instruction; it is not a request to create a task or repeat an authorization. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:19] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:41]

**The repeated reconstruction is redundant proof work, but its live identity check is not redundant.** Sanctioned template application retires/rebuilds the binding; out-of-band template-pointer/setup/enrollment changes have no such callback. Removing the check or freezing the Bank inventory would lose reachable behavior. Moving private template SQL into runtime composition would duplicate that owner's storage contract. An independent read-only advisor reached the same boundary conclusion; the concrete proposal is below. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:71] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82] [source packages/core/src/memory/hindsight/template-lifecycle/template-overlay-store.ts:35]

The new regression proves **eight unchanged Bank lookups cause eight full template-selection reconstructions after managed binding already succeeded**. The drain-budget regression passed **1/1** using Vitest's normal threads pool. Core and Shared typechecks and scoped ESLint passed. No replay, journey, Core server, Native server, PG or Home was started. [run artifact G:/taki-codex-work/tmp-ab/wave-b-focused-threads.log] [run artifact G:/taki-codex-work/tmp-ab/wave-b-check-exits.json]

## 2. Changes

| File | Actual change |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-runtime-template-cost.test.ts` | New managed-template fixture regression: construction must validate fully, but repeated unchanged ordinary Bank lookups must not invoke the full reconstruction reader. Currently red, intentionally left visible for the coordinated root fix. |
| This report | Observed profile evidence, mutation/detection inventory, precise proposed owner API, checks and remaining work. |

**No existing assertion was converted, weakened, removed or skipped.** No production module/header, folder index, spec, Shared, template/prompt file or leader-owned record was edited. There is no changed production contract to advertise in an index/spec yet. The requested spec/header/index updates remain part of the coordinated implementation. Tests are already implied by their folder index under the project convention.

`G:/taki-codex-work/tmp-ab/baseline-b/` was created. No production file needed a pre-edit copy because none was edited. The exact wave B delta is `G:/taki-codex-work/tmp-ab/p1ab-b.patch`; `wave-b-delta-manifest.json` records its two files and hashes. It excludes wave A and all inherited changes. [run artifact G:/taki-codex-work/tmp-ab/p1ab-b.patch]

## 3. Evidence and checks run

### Observed run and correction to the publication count

Read the leader's `G:/taki-post-reentry-kwNPGT/` metadata, CPU profile, Core log and scalar journal fields. The replay reports passed, chat notification at **43,220 ms**, chat observation total **43,281 ms**, fence free at **117,801 ms**, and first backup capture completed in **10,247 ms**. Post-chat fence occupancy was **74,581 ms**. The timer observer recorded **85 stalls >250 ms**, maximum **23,078.718 ms**. [run artifact G:/taki-post-reentry-kwNPGT/replay-result.json] [run artifact G:/taki-post-reentry-kwNPGT/maintenance-observation.json]

Recomputed the supplied inclusive breakdown using the same next-sample-delta convention as the leader's `stretch-breakdown.cjs`, loading the profile once. These are inclusive sampled elapsed-time estimates, not separately measured OS CPU seconds:

| Profile-relative window | Window length | `readTemplateSelectionIdentity` inclusive | Share |
| --- | ---: | ---: | ---: |
| Chat: 0–43,220 ms | 43.2 s | 33.456 s | 77.5% |
| Post-chat: 43,220–117,801 ms | 74.6 s | 56.467 s | 75.7% |
| Long stall before model request: 53,836–76,919 ms | 23.1 s | 19.198 s | 83.2% |
| First Native publication completion → local work completion: 79,547–111,465 ms | 31.9 s | 24.431 s | 76.5% |

Post-chat idle was **10.64%**. The profile is **80,781,504 bytes**. Its recorded inspector clock-alignment uncertainty is **±116 ms**, so sub-millisecond-looking absolute frame times are not that accurate. The leader's weighting and the analyzer's preceding-interval/clipping convention differ at individual sample edges; that does not change the dominant-owner conclusion. [run artifact G:/taki-codex-work/tmp-ab/wave-b-profile-windows.json] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/maintenance-profile-analysis.mjs:36]

**Correction:** three command jobs completed in Native, but only **two assessments** completed verified local application. The Core settlement is `status:failed, assessed:2, pending:9, edits:2, steps:1`; the third command's work remains `saved / publication_pending`. Thus “3 of 11 published” is accurate only at the Native-command boundary, not as three completed curator work items. The analyzer's two local-refresh upper bounds are correct. [run artifact G:/taki-post-reentry-kwNPGT/core.log] [run artifact G:/taki-post-reentry-kwNPGT/core-data/taki.db] [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:31]

Observation-output limitation noticed: the replay's top-level `passed` tests recall, observation completion, backup and cleanup; it does **not** require a successful curator pass. It can therefore be misread as complete maintenance acceptance. The policy-failure evidence is present in the timeline/Core log; no evidence was lost. I did not change that observation/acceptance meaning in this wave. Curator/Utility entry and exact tool/refresh-return times remain explicitly UNKNOWN where the sources lack them. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/post-reentry-replay.mjs:290] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/analyze-maintenance.mjs:26]

### Why the guard reconstructs everything

1. The connection captures `templateSelectionIdentity` by calling the full reader at construction. Every `assertEvidence()` calls that same reader and compares its result, then checks checkpoint floors. `assertConnection`, `banks`, `bank`, provider request assertions and shared replica scope resolution all reach it. The guard is not intentionally querying just a small current selector; its dependency combines identity derivation with complete evidence validation. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:71] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82] [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:57]
2. `readTemplateSelectionIdentity` enumerates every verified setup Bank, validates its checkpoint, resolves the exact-incarnation managed selection, checks lineage consistency, and hashes sorted selection identities plus defaults revision. A lookup for one body or one Character therefore validates all eligible managed Banks. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:41]
3. `readRuntimeTemplateSelection` validates enrollment/canonical identity and calls `readAppliedTemplateSelection`. That reader selects **all historical selection revisions**, parses/hashes every document, reconstructs each preview from enrollment/user/catalog history, compares request/projection/ownership and verifies the Native receipt/snapshot. The final current-identity hash is only the end of this work. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:19] [source packages/core/src/memory/hindsight/template-lifecycle/template-overlay-store.ts:35] [source packages/core/src/memory/hindsight/template-lifecycle/template-overlay-store.ts:57]
4. The November 6 change separated **authority** identity from authority proof, through `bindHindsightRuntimeAuthority`, but explicitly retained the existing connection/secret/**template**/Bank checks. It did not split this template dependency. That is the remaining ownership mismatch; the authority contract is not permission to delete all template checks. [source packages/core/src/memory/hindsight/hindsight-runtime-authority.ts:25] [source .trellis/spec/backend/memory-authority-validation.md:5] [source .trellis/spec/backend/memory-authority-validation.md:38]

### Every requested change path

| Change path | What else detects it today | Is the old binding retired/rebuilt first? What the current per-call check still contributes |
| --- | --- | --- |
| Template apply, revision, or applied defaults change | Durable active hold; executor/current-plan guards; publication identity and replacement-binding verification. | **Yes for sanctioned rollout:** hold → old binding retirement/settlement → Native apply/sync → publication → replacement binding. Reconstructing all history at every old-runtime call is unnecessary to detect this flow, while hold/lifetime checks remain necessary. [source packages/core/src/memory/hindsight/template-lifecycle/template-plan-store.ts:44] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-control.ts:29] [source packages/core/src/memory/hindsight/template-lifecycle/template-rollout.ts:36] [source packages/core/src/memory/hindsight/template-lifecycle/template-execution-service.ts:82] |
| Verify/provision a new Character Bank while bound | B3 verification updates setup; `readRuntimeBanks` reads current verified routes. Legacy provisioning requests full sync on the existing scheduler. Managed provisioning delegates to the template lifecycle. | **Legacy v1 stays bound**, so its new route must become visible dynamically without changing null/unmanaged template identity. Managed provision uses hold/retirement/publication/rebind. A newly eligible managed selection introduced without that lifecycle has no retirement callback: the current aggregate check is its immediate detector. Do not freeze every Bank row at construction. [source packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-provision.ts:30] [source packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-provision.ts:48] [source packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-provision.ts:88] [source packages/core/src/memory/hindsight/hindsight-bank-setup.ts:53] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:130] [source packages/core/src/memory/hindsight/template-lifecycle/template-provision.ts:113] |
| Bank deletion / setup removal | Once synchronized locally, provider Bank lookup and replica checkpoint readers reject deleted/unbound Banks; transition-bound checkpoint floors also reject deletion. Removed setup rows disappear from live routes. | **No automatic whole-binding retirement from these reads.** Targeted reads reject the missing/deleted Bank, while the template aggregate additionally notices changed managed membership even during an unrelated Bank guard. A Native-only deletion not yet synchronized is not something this local template reader can detect. [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:103] [source packages/core/src/db/hindsight-application-replica-checkpoint.ts:56] [source packages/core/src/memory/hindsight/hindsight-runtime-authority.ts:56] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:45] |
| Local/Hindsight transitions | Current authority tuple checks detect changed epoch/provider/lineage/receipt; publication and target construction validate complete proof. | Old references retire before target construction; there is a fresh connection on Hindsight re-entry. Current-authority guards also reject old references once the marker has committed, before any later use. Repeated template history reconstruction is unnecessary to detect that authority switch itself. [source packages/core/src/memory/hindsight/hindsight-runtime-authority.ts:25] [source packages/core/src/memory/transitions/transition-runtime.ts:79] |
| Restore | Supported paired restore validates a stopped copied Core, exact pair/template observation and replica closure before writer construction. Native rollback has separate cursor/rollback handling. | Supported paired restore entails **new full construction**. A live Native-only restore does not change the local template identity, so this reader cannot establish remote freshness. Hot replacement/edit of a running Core DB is the out-of-band case, not the supported paired-restore path. [source packages/core/src/memory/hindsight-backup/hindsight-backup-restore.ts:2] [source packages/core/src/memory/hindsight-backup/hindsight-backup-restore.ts:32] [source .trellis/spec/backend/memory-hindsight-backup.md:190] |
| Out-of-band Core DB change | Authority/config guards and checkpoint validation catch their own fields. Immutable/CAS triggers prevent normal template-row update/delete/replacement, but do not make offline corruption or deliberate trigger removal impossible. | **No retirement/rebuild first.** For template-only applied/default pointers, enrollment/setup consistency or managed membership, this guard is the running connection's immediate detector. Full reconstruction also catches document-body corruption incidentally. A cheap metadata reader cannot honestly promise that same body-corruption detection timing without reading/verifying those bodies. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:74] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:19] [source packages/core/src/db/migrations/058-hindsight-template-overlays.ts:11] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:77] |

### Exact coordination request: smallest root change

Ask the parallel template owner to add a **distinct cheap current-identity port** in `template-runtime-selection.ts`, tentatively:

```ts
readCurrentRuntimeTemplateIdentity(db: Database, epochId: string): string | null
```

It must preserve the existing identity value for intact data: epoch; Bank-id-sorted managed selections with complete namespace, selection revision, receipt hash and template revision; plus selected-lineage defaults revision. Keep `readTemplateSelectionIdentity` as the full proof-producing/validating reader used by construction, publication, recovery and original receipt comparisons. Do not repurpose it silently or change persisted/public selection identities. No Shared protocol or schema change is proposed. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:55] [source packages/core/src/memory/hindsight/template-lifecycle/template-publication.ts:34] [source packages/core/src/memory/hindsight/template-lifecycle/template-recovery-admission.ts:32]

The owner should implement the necessary compact current joins/checks using its existing storage columns, not through `readAppliedTemplateSelection` or preview reconstruction:

- Current eligible verified setup scope/canonical identity/Bank ID/template revision/digest; current checkpoint epoch, deletion and full namespace; exact-incarnation enrollment identity.
- Applied pointer and matching selected-row existence/key/revision/receipt hash, with the template revision required by the existing identity payload; selected-lineage defaults pointer/revision and corresponding current metadata consistency.
- Preserve null/unmanaged semantics: absent template storage or no eligible applied managed selections returns null. Unenrolled or enrolled-but-unapplied legacy Banks remain supported. Verified non-v1 rows with missing/wrong-epoch/deleted checkpoints retain their refusal. Dynamic legacy Character routes must still work.
- Do **not** include mutable checkpoint cursors, all legacy route inventory, or unapplied user/catalog changes in the template selection identity. Those would turn legal ongoing work into drift.
- Do not claim that a stored `document_hash` proves unchanged document bytes. Document-only corruption with unchanged current metadata needs the explicit boundary decision below; unchanged full/consuming readers remain responsible for body/hash/projection proof. [source packages/core/src/memory/hindsight/template-lifecycle/template-store-documents.ts:19] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:34] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:71]

After that owner API and contract are agreed, the local runtime edit is small: keep full construction verification and `assertRuntimeTemplateBanks`; compare the cheap current identity against the fully validated captured identity inside `assertEvidence`, retaining current authority/config/secret/hold/executor and checkpoint-floor checks. Prove cheap/full identity equality for intact managed fixtures. Keep `templateSelectionIdentity` and publication/recovery semantics unchanged. Update the runtime module header and `hindsight/index.md`, and document the rule in `memory-authority-validation.md` plus the template owner's contract. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:63]

**Why not bypass `bankScope` instead?** In the sync cache callback, `publicationGuard` checks the connection and `cachedBody` then calls `assertApplicationPublication` twice, reaching the same guard again. Those are redundant within that specific synchronous read. However, the same shared scope callback also serves standalone repo reads, curator work, command admission and publication; it does not receive proof that some containing request already ran the guard. Globally changing it to unguarded routing would drop checks on those paths. A function-local verified reader inside one synchronous segment could reuse the guard, but would require adapting multiple callers and would leave per-request/curator reconstruction elsewhere. The existing spec explicitly prohibits treating the shared scope callback as unguarded routing. Keep it guarded and make the identity read cheap at its owner first. [source packages/core/src/memory/hindsight/hindsight-runtime-state.ts:101] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:96] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:232] [source packages/core/src/db/hindsight-application-replica-cache.ts:13] [source .trellis/spec/backend/hindsight-application-runtime.md:164]

### Tests and checks

The new cost regression uses the existing managed `templateLifecycleFixture` and an actual `hindsightRuntimeFixture` subsystem. It applies a template through the existing operation fixture, requires successful managed binding and a non-null full identity, then performs eight unchanged `runtime.bank` lookups within one synchronous DB transaction. The spy observes, rather than stubs, the full reader. Its intended expectation is zero full reconstructions after binding; current code produces **8**. This is a demonstrated cost failure, not a failed fixture setup. [source packages/core/src/memory/hindsight/hindsight-runtime-template-cost.test.ts:9] [run artifact G:/taki-codex-work/tmp-ab/wave-b-focused-threads.log]

Commands, all with `TEMP=TMP=G:/taki-codex-work/tmp-ab` and cwd `H:/TakiAgent`:

```powershell
# Default process pool: sandbox-blocked before any test executed.
pnpm --dir packages/core exec vitest run src/memory/transitions/transition-healthy-drain-budget.test.ts --maxWorkers=2

# Supported worker-thread pool: one deliberate cost failure, drain regression passed.
pnpm --dir packages/core exec vitest run src/memory/hindsight/hindsight-runtime-template-cost.test.ts src/memory/transitions/transition-healthy-drain-budget.test.ts --pool=threads --maxWorkers=2

pnpm --dir packages/shared typecheck
pnpm --dir packages/core typecheck
pnpm exec eslint packages/core/src/memory/hindsight/hindsight-runtime-template-cost.test.ts
```

| Check | Actual result |
| --- | --- |
| Default forks drain test | **Sandbox-blocked:** `spawn EPERM` while starting the Vitest worker; zero test execution. Not a product failure. [run artifact G:/taki-codex-work/tmp-ab/wave-b-drain-test.log] |
| Threads focused pair, Vitest 4.1.10 | **1 failed / 1 passed** in 6.57 s: cost regression intentionally red with 8 calls; drain-budget regression 1/1 green. [run artifact G:/taki-codex-work/tmp-ab/wave-b-focused-threads.log] |
| Shared typecheck | Passed, exit 0. [run artifact G:/taki-codex-work/tmp-ab/wave-b-shared-typecheck.log] |
| Core typecheck | Passed, exit 0. [run artifact G:/taki-codex-work/tmp-ab/wave-b-core-typecheck.log] |
| Scoped ESLint | Passed, exit 0. [run artifact G:/taki-codex-work/tmp-ab/wave-b-eslint.log] |
| Offline profile verification | Reproduced the leader's four-window attribution and clock limitation. [run artifact G:/taki-codex-work/tmp-ab/wave-b-profile-windows.json] |

Identity-change regressions after the API exists remain pending, rather than being claimed from today's unchanged code. Required cases are: sanctioned apply/default/revision retirement and fresh bind; legacy Character provision while still bound; newly eligible managed membership; setup/enrollment/pointer/receipt/default identity changes; missing/deleted/wrong-generation checkpoint; transition retirement; intact paired-restore reconstruction; and the explicitly agreed historical-body corruption boundary. Existing full-reader tests must continue rejecting the corruption they consume. No full-reader assertion should be converted merely to make the cheap guard test green. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:60] [source packages/core/src/memory/hindsight/hindsight-runtime-verification.test.ts:42]

## 4. Trade-offs

1. **Preserve live detection; move only proof work.** Cheap current-pointer/identity checks can remove the measured reconstruction while retaining live drift refusal. Full reconstruction remains at construction, publication, recovery and actual template-data consumption.
2. **Body-corruption timing must be explicit.** A pointer/header-only reader cannot detect arbitrary document-body changes whose metadata was left unchanged. Moving that incidental per-call detection to full/consuming readers is a real behavior trade-off, not a claim that corruption is impossible. The current-authority contract already distinguishes historical proof from current consumed data, but the exact template classification must be owned and documented before implementation. [source .trellis/spec/backend/memory-authority-validation.md:58]
3. **No duplicate storage owner or verdict cache.** I did not introduce template-table joins in `hindsight-runtime-connection.ts`, a process-wide identity cache, a TTL, or a SQLite mutation-counter cache. They would conceal the required ownership/validation decision or add new invalidation obligations.
4. **Keep shared `bankScope` guarded.** It still has responsibility outside a caller's already-checked synchronous segment. Making its dependent identity lookup cheap addresses every path together; further callback-local reuse can be considered only with explicit lifetime evidence.
5. **The delivered delta is intentionally incomplete.** The new failing test is visible and must not be mistaken for a ready-to-merge implementation. No timeout, curator lifetime, memory semantics, public identity or replay assertion was relaxed.

## 5. Open items / UNKNOWN

- **Leader coordination required:** assign/approve the cheap identity API under `template-lifecycle/**`, including its body-corruption detection boundary. The proposed API, exact invariant fields and unchanged public identity are specified above. No Shared change is currently needed.
- After that API exists: implement the small runtime consumer change; add/run the identity-change matrix; turn the cost regression green; update owner/runtime specs, module headers and indexes; repeat the focused checks. These are not completed in this delivery.
- **Expected next replay:** this report/test-only delta changes no runtime cost, so replaying it alone should not improve the 43.3 s chat or 74.6 s maintenance. After the coordinated root fix, expect ordinary guards to contribute no full template-history reconstruction, shorter chat/maintenance and potentially enough lifetime for all curator work to complete. Those performance and completion outcomes remain unverified, not promised from a green cost test. Keep first-attempt backup and all existing lifetime/error assertions.
- Journey steps 12/13 may benefit when they use the same runtime dependency, but their independent template/component proof work remains required. No claim is made that all of their 382 s/623 s durations disappear.
- The actual improvement magnitude, curator completion, real replay behavior and Home acceptance are UNKNOWN until the leader's next run. No replay/journey was started here.
- Disposition: both Vitest attempts and type/lint commands exited. Fixtures used G: temporary roots and their existing cleanup. No owned server/listener, Native, PG, Home or external model call needs cleanup.

## 6. Anything outside scope noticed (not fixed)

- The observation replay can report `passed` while the separately recorded policy pass failed; see the acceptance-coverage limitation and corrected two-versus-three count above. No observation-harness behavior was changed.
- Some helper/spec language still uses “identity” for a read that proves full historical documents. The coordinated API/spec split should make that responsibility explicit rather than adding another persistent cache around it.
- The parallel template session may change the implementation or introduce the requested port while this report is being reviewed. Recheck the live exported API and its contract before consuming it; this report does not authorize editing that owner's files.

## Wave C — 2026-11-08

### 1. Outcome

**PARTIAL: the production optimization, approved identity matrix, documentation and static checks are complete. One existing test assertion needs a further template-owner exception.** The focused run passed **130/131 tests across 12 files**. Its only failure is `template-runtime-control.test.ts:138`, which expects an ordinary warmed guard to revalidate a historical enrollment document hash. That test lies outside Wave C's permitted template source/test pair and was not edited. The concrete proposed conversion is `G:/taki-codex-work/tmp-ab/wave-c-runtime-control-proposed.patch`; approval was requested for that test alone. [run artifact G:/taki-codex-work/tmp-ab/wave-c-focused.log] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-control.test.ts:138]

`readCurrentRuntimeTemplateIdentity` now supplies ordinary connection evidence guards. Construction still captures the unchanged full identity; the new reader compares current identity against that value without reconstructing any selection history or previews. The cost test went from **8 full reconstructions for 8 Bank lookups to 0**, and also asserts zero applied-history-reader calls after binding. Core and Shared typecheck and scoped ESLint passed. No replay, journey, Core server, Native, PG or Home process was started. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:66] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:71] [source packages/core/src/memory/hindsight/hindsight-runtime-template-cost.test.ts:9] [run artifact G:/taki-codex-work/tmp-ab/wave-c-check-exits.json]

The preceding Wave B BLOCKED outcome is historical; the owner authorized and this wave implemented its production proposal. This does not claim the remaining protected test has been converted or that a large-library replay has passed with the optimization. [inference]

### 2. Changes

| File | Purpose |
| --- | --- |
| `packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts` | New current-row reader and private current-selection/defaults helpers; unchanged full reader. Updated module header. |
| `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts` | Only `assertEvidence` switches readers. Full construction identity, authority/configuration/secret/hold/executor/checkpoint-floor checks remain unchanged. Updated module header. |
| `packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts` | Added intact equality, live drift, null/legacy, checkpoint, desired-change and body-corruption boundary cases. Original full-reader tests remain unchanged. |
| `packages/core/src/memory/hindsight/hindsight-runtime-connection.test.ts` | New production retirement/rebinding, actual legacy `applyHindsightBank`, and healthy transition retirement regressions. |
| `packages/core/src/memory/hindsight/hindsight-runtime-template-cost.test.ts` | Removed obsolete intentionally-red comment; retained its original zero-reconstruction assertion and added a zero-applied-history assertion. |
| `packages/core/src/memory/hindsight/index.md`, `packages/core/src/memory/hindsight/template-lifecycle/index.md` | Updated only the affected module entries, as required by Wave C housekeeping. |
| `.trellis/spec/backend/hindsight-application-runtime.md`, `.trellis/spec/backend/memory-authority-validation.md`, `.trellis/spec/backend/hindsight-template-lifecycle.md` | Current template identity versus full proof, unchanged public identity, current projection requirement and explicit corruption-detection boundary. |
| This report | Appended Wave C evidence and the outstanding protected-test conversion. |

Both production files, and every pre-existing file changed in this wave, were copied before their first edit under `G:/taki-codex-work/tmp-ab/baseline-c/`, preserving relative paths. The exact implemented delta is `G:/taki-codex-work/tmp-ab/p1ab-c.patch`; it excludes inherited changes, Wave A/B changes and the unapproved test proposal. The file/hash manifest is `wave-c-delta-manifest.json`. No Shared or other template implementation file changed. [run artifact G:/taki-codex-work/tmp-ab/baseline-c/] [run artifact G:/taki-codex-work/tmp-ab/p1ab-c.patch]

**Existing assertion conversions actually applied: none.** The one proposed conversion is the ordinary-guard expectation at `template-runtime-control.test.ts:138`: change it to `not.toThrow()` and add a fresh `createHindsightRuntimeConnection(...)` expectation for the original `HINDSIGHT_RESPONSE_INVALID`. Preserve the existing hash mutation, rollback and live-hold assertions. This moves historical proof verification to its approved construction boundary; it does not weaken a full-reader test. The proposal also renames that test to state its new boundary. [run artifact G:/taki-codex-work/tmp-ab/wave-c-runtime-control-proposed.patch]

### 3. Evidence and checks run

The current reader checks verified setup and exact checkpoint namespace/epoch/deletion, exact enrollment identity, before-image existence, current applied pointer/selected-row identity and metadata, referenced base/user existence, and defaults pointer/revision/lineage consistency. Intact identity payload/hash is unchanged. `readTemplateSelectionIdentity` was compared with the pre-edit copy and its entire function is identical. Existing construction, publication, recovery and receipt-comparison callers were not changed; only the ordinary `assertEvidence` call was replaced. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:41] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:90] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82] [run artifact G:/taki-codex-work/tmp-ab/wave-c-static-audit.json]

| Required case | Evidence and result |
| --- | --- |
| Cheap/full equality, multiple Banks, changed defaults | Two managed Banks compare equal; independently publishing defaults revision +1 changes both identities equally and refuses the older binding. Fresh construction accepts the new identity. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:111] |
| Sanctioned apply, Bank template revision, defaults change | Three real operation rollouts use production composition retirement/rebinding. The prior connection is cancelled and no runtime is published before each Native apply; a fresh connection follows publication and its full/current identities agree. Synchronization uses the existing fixture's synthetic checkpoint advancement. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.test.ts:27] |
| Legacy Character provision while bound | Actual `applyHindsightBank` verifies a new v1 setup row. The same connection sees the new Character route; both identities remain null. No rebind is introduced. Native transport is a fixture double. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.test.ts:63] |
| Newly eligible managed membership | A managed Character changing from pending to verified invalidates the binding that captured only Global membership. The current reader still matches the complete original identity. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:146] |
| Setup/enrollment/pointer/receipt/defaults drift | Twenty targeted offline-edit cases cover canonical identity, scope, template revision/digest, setup/enrollment removal, enrollment identity metadata, missing before-image/current/user/default evidence, applied/default pointers, receipt column/document metadata and defaults revision/lineage. Each refuses the captured runtime; the former full-reader guard also refuses. Offline tests explicitly bypass immutable triggers/FKs where needed. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:157] |
| Missing, deleted, wrong-epoch or wrong-generation checkpoint | Four coherent checkpoint cases refuse the old connection. Missing/wrong-epoch/deleted non-v1 checkpoints retain direct current-reader refusal; a changed generation removes the exact-incarnation membership and changes the identity. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:190] |
| Null and legal changes | Absent storage, untracked legacy and a truly checkpointed enrolled-but-unapplied Bank return null. Mutable cursors and unapplied user/catalog revisions leave identity unchanged. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:129] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:210] |
| Body-corruption boundary | An out-of-band catalog body change with metadata/hash columns untouched passes the ordinary guard but fails the unchanged full reader, fresh construction and consuming selection reader. A changed current projection still fails its required setup-digest check. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:226] |
| Transition retirement | Actual healthy return-to-Local and Hindsight re-entry keep the former connection cancelled and construct a distinct usable replacement. Existing current-authority/checkpoint-floor verification tests also pass. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.test.ts:85] [run artifact G:/taki-codex-work/tmp-ab/wave-c-focused.log] |
| Long fence holder | `transition-healthy-drain-budget.test.ts` passed again within the focused run; its original assertions were not changed. [run artifact G:/taki-codex-work/tmp-ab/wave-c-focused.log] |

Commands used from `H:/TakiAgent`, all with `TEMP=TMP=G:/taki-codex-work/tmp-ab`:

```powershell
$env:TEMP = 'G:/taki-codex-work/tmp-ab'
$env:TMP = $env:TEMP
pnpm --dir packages/core exec vitest run src/memory/hindsight/hindsight-runtime-template-cost.test.ts --pool=threads --maxWorkers=2
# Baseline: intentional failure with 8 full-reader calls; before the production edit.

$tests = @(
  'src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts',
  'src/memory/hindsight/template-lifecycle/template-selection.test.ts',
  'src/memory/hindsight/template-lifecycle/template-overlay-store.test.ts',
  'src/memory/hindsight/template-lifecycle/template-runtime-control.test.ts',
  'src/memory/hindsight/hindsight-runtime-connection.test.ts',
  'src/memory/hindsight/hindsight-runtime-verification.test.ts',
  'src/memory/hindsight/hindsight-runtime-template-cost.test.ts',
  'src/memory/transitions/transition-healthy-drain-budget.test.ts',
  'src/memory/hindsight/hindsight-memory-reflect-deadline.test.ts',
  'src/memory/hindsight/hindsight-memory-subsystem.test.ts',
  'src/memory/hindsight-runtime-composition.test.ts',
  'src/memory/hindsight-runtime-binding.test.ts'
)
pnpm --dir packages/core exec vitest run @tests --pool=threads --maxWorkers=2
pnpm --dir packages/core typecheck
pnpm --dir packages/shared typecheck
$changedPaths = Get-Content -Raw G:/taki-codex-work/tmp-ab/wave-c-files.json | ConvertFrom-Json
pnpm exec eslint --no-warn-ignored @changedPaths
```

| Check | Result |
| --- | --- |
| Red cost regression | Expected failure: 8 full reconstructions. [run artifact G:/taki-codex-work/tmp-ab/wave-c-cost-red.log] |
| First selection/cost run | 40 passed, two new checkpoint-fixture failures. Corrected those fixtures to keep native/application checkpoint identity coherent, reaching the intended epoch/generation refusal. [run artifact G:/taki-codex-work/tmp-ab/wave-c-selection-first.log] |
| Corrected selection + new connection run | 44/44 passed in 45.36 s. [run artifact G:/taki-codex-work/tmp-ab/wave-c-identity-matrix.log] |
| Final focused run, including two additional missing-row cases | 130 passed / 1 protected stale assertion failed; 11 files passed / 1 failed; 108.57 s. No `EPERM` failures. [run artifact G:/taki-codex-work/tmp-ab/wave-c-focused.log] |
| Core / Shared typecheck | Both passed, exit 0. An initial Core error for an unchecked SQL property was fixed using the declared integer pointer value; the final check is green. [run artifact G:/taki-codex-work/tmp-ab/wave-c-core-typecheck.log] [run artifact G:/taki-codex-work/tmp-ab/wave-c-shared-typecheck.log] |
| ESLint | Passed, exit 0, with every changed path supplied. Repository ESLint ignores Markdown; this is TS lint evidence, not a Markdown lint claim. [run artifact G:/taki-codex-work/tmp-ab/wave-c-eslint.log] [run artifact G:/taki-codex-work/tmp-ab/wave-c-check-exits.json] |
| Independent read-only review | No blocking production defect found. Its two coverage gaps were fixed: the unapplied branch now has a real checkpoint, and actual legacy provisioning is covered on the same connection. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.test.ts:133] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.test.ts:63] |

### 4. Trade-offs

1. **Current projection cost remains.** Selection storage has no independent projection-digest column, and the existing aggregate identity excludes setup digest. Reading scalar metadata alone would silently lose setup-only digest drift detection. The new reader extracts the current selected projection and uses the unchanged digest function. It does not reconstruct a preview or validate any selection history, receipt or snapshot; SQLite still reads the current JSON row, so cost depends on that row/projection's size. Execution-plan digests are not a universal substitute because selections need not have a plan. No new storage, cache or invalidation owner was introduced. [source packages/core/src/db/migrations/058-hindsight-template-overlays.ts:48] [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-selection.ts:110] [source packages/core/src/memory/hindsight/template-lifecycle/template-projection.ts:27]
2. **Historical proof detection moves.** Unconsumed template document-body corruption, and corruption of historical document proof hashes, is detected by the next full/consuming validation. Ordinary guards do not rehash those documents. Current metadata used for identity and the consumed current projection still refuse drift. This precise distinction is documented in all three requested specs; stored hashes are never claimed to prove current bytes without validation. [source .trellis/spec/backend/memory-authority-validation.md:50]
3. **Shared Bank scope remains guarded.** Repeated body/curator lookups still perform current connection checks. Removing them globally would lose standalone/publication admission checks. The shared expensive historical reconstruction is removed at its template owner instead. Current aggregate assembly is deliberately kept equal to the unchanged full reader and covered by equality tests. [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82] [source .trellis/spec/backend/hindsight-application-runtime.md:164]
4. **No deadline or maintenance semantic changes.** Backup drain budgets, curator lifetime, publication verification and first-attempt backup behavior were not relaxed. No performance magnitude or curator success is inferred from the cost test alone. [inference]

### 5. Open items / UNKNOWN

- **Owner action:** approve/apply the single protected test conversion described above, then run `template-runtime-control.test.ts --pool=threads --maxWorkers=2` and lint that file. No other template implementation edit is needed. Until then the full focused gate is truthfully 130/131, not green. [run artifact G:/taki-codex-work/tmp-ab/wave-c-runtime-control-proposed.patch]
- **Leader's next replay:** run the existing observation command against a newly prepared leader-owned root. Expected result: no `readTemplateSelectionIdentity` / full-history reconstruction beneath ordinary `assertEvidence`; shorter chat and post-chat maintenance, with residual current-projection/current-row cost measurable separately. Construction/publication/recovery/actual template-consuming stacks may still contain full validation. Curator completion and first-attempt backup must be observed, not assumed. [inference]
- **Baseline to compare:** chat 43.2 s with 33.456 s full-identity inclusive time (77.5%); post-chat 74.6 s with 56.467 s (75.7%); 23.1 s pre-request stall with 19.198 s (83.2%); 31.9 s publication-to-local-work interval with 24.431 s (76.5%). There were 85 stalls above 250 ms, maximum 23,078.718 ms; fence free at 117,801 profile-relative ms; backup succeeded first attempt in 10,247 ms. Preserve the Wave B count correction: three Native completions, two verified local assessments, nine pending. [run artifact G:/taki-post-reentry-kwNPGT/maintenance-analysis.txt] [run artifact G:/taki-codex-work/tmp-ab/wave-b-profile-windows.json]
- Actual new large-library timing, curator completion and journey steps 12/13 improvement remain **UNKNOWN** until the leader runs them. No new replay/journey was started here. [inference]
- All owned test/typecheck/lint processes exited. Fixtures used G: temporary roots and their existing cleanup. No owned Core/Native/PG/Home service or listener remains to stop. [run artifact G:/taki-codex-work/tmp-ab/wave-c-check-exits.json]

### 6. Anything outside scope noticed (not fixed)

- The protected runtime-control assertion is a real outstanding test update caused by the approved validation-boundary change. Its concrete patch is separate from the implemented delta; it was not silently skipped, weakened or applied across the ownership boundary. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-control.test.ts:138]
- The existing observation replay's top-level `passed` still does not assert curator success; the Wave B explanation and corrected assessment count remain applicable. Observation harness behavior was not changed. [run artifact G:/taki-post-reentry-kwNPGT/replay-result.json]
- Inherited uncommitted work, all other template-owner files, Shared, prompts, leader-owned records and task lifecycle state were left outside this delta. [run artifact G:/taki-codex-work/tmp-ab/p1ab-c.patch]
