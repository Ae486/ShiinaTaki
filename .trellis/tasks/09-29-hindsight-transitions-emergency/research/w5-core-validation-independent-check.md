# W5 Core validation and W4 installed-order independent check

Checked on 2026-10-04 by `/root/w45_readonly_review` against the existing task. No new task or lifecycle change.

**Scoped verdict: PASS.** No new production defect was found in the delivered Core validation-context and W4
installed-order repair. The five remaining root-lint length exceptions are explicitly retained below; root lint is
not globally green. The parent may continue only the same real RETURN under the existing cumulative 329-request
ceiling, with 301 already used and 28 remaining. This result does not establish real RETURN completion, re-entry,
full roundtrip, W5 completion, or manual acceptance. **W5 remains INCOMPLETE.**

## Findings (fixed)

No additional source fix was needed by this reviewer. The delivered repairs were independently checked:

- `transition-evidence-context.ts` removes repeated full native-evidence parsing/hashing within one synchronous
  boundary. Its first stored read still executes the original document/schema/native/application/body/proof checks.
  Reuse requires the same live database owner, verified object identity and unchanged actual stored row identity and
  complete body bytes. JSON is recursively frozen; returned Maps and byte arrays are isolated. Return, throw and
  asynchronous misuse close the outer context.
- Candidate builders, final-proof creation, `publishMemoryTransition` and independent receipt reconstruction create
  fresh contexts. Internal candidate, projection, Pending Source, baseline, Bank proof, installation and read-back
  callers share only that boundary's context. Current configuration, source, custody, queue, executor and lease
  joins are still independently checked. No timer, lease duration, Native TTL, transaction or public operation
  ownership protocol was weakened.
- `hindsight-application-replica-publication.ts` accepts a context only on the retained transition snapshot path,
  checks its database owner and uses its independently reconstructed bundle. Ordinary D77 snapshot/event validation
  and TTL checks are unchanged. The retained path still runs application bundle and native contents validation.
- `memory-transition-publication-repo.ts` applies the existing `sortState` to freshly discovered installed state
  before exact comparison. This sorts outer arrays only, retains duplicates/counts/payloads and does not reorder
  nested SourceSet references. Mixed mental-model/directive order succeeds; changed installed derived payload
  refuses and rolls back selection, rows and receipt.
- Healthy primary/heartbeat/abort/service diagnostics contain only closed internal codes and stage labels.
  Error metadata getters and logger failure are contained. The diff preserves the existing abort/unknown-outcome
  control flow. A production publication-failure regression confirms the failed stage and absence of a receipt.
- The three changed backend specs and the transition/database/testing indexes describe the actual contract and
  affected files. No platform template, detector, migration or generated-client touch point is implicated.

## Findings (not fixed)

Root `pnpm lint` exits 1 with exactly five `max-lines-per-function` errors and zero warnings:

| File and line | Function | Current lines / limit |
| --- | --- | --- |
| `packages/core/src/memory/hindsight-runtime-binding.ts:51` | `createHindsightRuntimeBinding` | 55 / 50 |
| `packages/core/src/memory/runtime-composition.ts:64` | `composeMemoryRuntime` | 51 / 50 |
| `packages/core/src/memory/runtime-selector.ts:49` | `selectMemoryRuntime` | 55 / 50 |
| `packages/core/src/memory/transitions/transition-native-session.ts:26` | `createTransitionNativeSession` | 63 / 50 |
| `packages/core/src/memory/transitions/transition-runtime.ts:27` | `createMemoryTransitionRuntime` | 51 / 50 |

These are unchanged functions outside this repair's 24-file scope and are a subset of the seven previously accepted
length exceptions in `w5-independent-lint-final.log`. The current repair removes the prior service/projection
violations. Refactoring unrelated lifetime/composition owners would expand the approved repair, so no new exemption
or unrelated refactor was introduced. This scoped verdict must not be described as a passing full root lint gate.

## Verification

The following commands were newly executed by this reviewer, sequentially, with no overlapping heavy checks:

| Check | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/memory/transitions src/db/memory-transition-publication src/db/memory-transition-custody.test.ts src/db/memory-transition-native-outcome.test.ts src/db/hindsight-application-replica-repo.test.ts --maxWorkers=2` | PASS, exit 0; 27 files / 178 tests; 98.27 seconds |
| `pnpm typecheck` | PASS, exit 0; all five workspace projects completed |
| `pnpm exec eslint <18 TypeScript files from w5-core-validation-source-manifest.json>` | PASS, exit 0; no diagnostics |
| `pnpm lint` | FAIL, exit 1; the five existing length errors above, zero warnings |
| Source/preimage and final evidence audit | PASS; all 24 current files and all 20 initial/supplemental preimages match |

The 13 new tests are included in the 178. Coverage includes context lifetime/defensive views/foreign owner and
object, changed or deleted stored evidence, finite synchronous processing cost without heartbeat, genuine lease
exhaustion with rollback, fresh proof-to-COMMIT and post-COMMIT reads, installed ordering/content corruption,
sanitized failure diagnostics, complete synthetic journeys, reconstruction, custody and ordinary D77 publication.

No Native service, owned PostgreSQL fixture, real model request, complete HTTP export or large-corpus replay was
newly run in this review. Native/Rust/full unrelated test suites were not rerun for this Core-only repair. At the
parent's explicit request the already completed manifest-bound corpus replay was reviewed instead of repeated.

## Review of saved corpus evidence

The reviewer read `w5-core-publication-clock-diagnostic.mjs` and independently checked its final result's manifest
binding, recorded elapsed guards and persisted SQLite copy. The source connection is read-only; backup creates a
fresh random task-owned copy. Only the exact historical recovery operation's state query is viewed as running by
the diagnostic facade. Actual source/configuration/candidate/proof/COMMIT joins run in the copy. Historical time
allows reproduction; separate elapsed-clock production lease guards expose whether real elapsed work fits the
historical available lease. The script records such guard failures rather than using its process exit alone as
proof of timing success. All eight recorded guards pass in the saved final result.

The following timings are **implementation evidence reviewed here, not new reviewer measurements**:

| Boundary | Saved final duration |
| --- | ---: |
| Candidate builder | 41,018 ms |
| Independent proof | 38,337 ms |
| Atomic publication and read-back | 60,324 ms |
| Independent reconstruction | 38,548 ms |
| Entire sequence | 178,251 ms |

The recorded available lease is 255,482 ms. Reconstruction is a read-only boundary without its own lease guard;
the entire recorded sequence is nevertheless below that available duration. The saved copy was opened with
SQLite `mode=ro&immutable=1` and `query_only=ON` for this audit. Its persisted candidate and selected epoch agree:
2 Banks, 1,262 records, 722 Sources, 1,262 SourceSets, 4 derived objects, exactly 1 candidate / receipt / publication.
The state hash is `c05adf7b6629df18329438b94ae1933013b97f73de2ec863205aacc32ecdaba8`; the mapping hash is
`fa57cbe4a071cd68c7e8b47cf27074f091226963ffee7c69d184696731faa00f`.

The real working SQLite was separately opened read-only: 0 candidates, 0 receipts, 0 publications, 1 reservation,
0 scope IDs. Its SHA256 remains `6d9c381b11045722f1b6086d04e886d6c6bfcde8ab8cddf84091f519e1e7891c`.
No original or existing diagnostic database was mutated. A successful disposable-copy COMMIT is not a real RETURN.

## Source identity and handoff

- Core checkout: `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native HEAD remains `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; this review made no Native changes.
- Implementation manifest SHA256: `bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4`.
- Initial preimage manifest SHA256: `7e8a25a47be1253c4e5205862e958d8fa1967f697b1e3e885c3172916cb4f4fe`.
- Reviewed replay script SHA256: `0166ec1861254bf0e7f2699dbe94bb1ee56beddc8862e4d4c4a52440f059ff1c`.
- Reviewed final result SHA256: `c27291eb6f4adc70f15188f7d5bae9dad1794524ff515c14bf75c15b2af1a4fd`.
- New audit inventory: `w5-core-validation-independent-source-hashes.json`. Prior reports, results, inventories,
  preimages and Native independent-check artifacts remain preserved; no old result was regenerated or overwritten.

No production, test or specification source changed during this review. Only this report and its new audit inventory
were added. Every spawned test/type/lint process has exited. No real runtime was started, credentials or budgets
changed, Git mutated, or task lifecycle advanced. The cumulative request count remains the parent's stopped
301/329 state; this review consumed zero model requests.

Continuation must preserve transition `df47f32c-48a8-47bc-9792-2e24e8642084`, its existing request/proof/maintenance
history and completed actions. Native proof reuse must use the existing exact protocol. Completion still needs the
real selected receipt, runtime binding, native release and operation outcome. Re-entry/full roundtrip and W6-W8
remain separate gates.
