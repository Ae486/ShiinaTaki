# B2 Core lifecycle implementation

Status: Core B2 implementation and planned self-checks complete; source and the heavy-check slot are released.
This report is not independent B2 acceptance and does not authorize B3. Pause after this handoff as requested.
The final source boundary is `b2-core-source-current-03.json` (101 files), with Core/Shared inputs in
`b2-core-read-check-input-05.json` (1550 files) and Desktop/CLI inputs in `b2-core-consumer-check-input-01.json`
(391 files). Main HEAD remains `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`.
No real deployment, original data, credentials, model provider, dependency or Git lifecycle was used.

## Implemented scope

- `memory/hindsight/template-lifecycle/`: Core-owned preview and original-plan execution, immutable per-Bank
  requests, executor CAS/expiry, durable unpublished-effect holds, partial recovery, final atomic selection/default
  publication, binding-only recovery, scope-specific provisioning and managed/v1 revalidation.
- `memory/operations/`, runtime composition/binding/subsystem and `boot/`: the existing operation owner and
  runtime lifetime remain authoritative. Held reads/writes and conflicting operations refuse; primary witnesses
  remain durable. W6 quarantine preserves the original plan/reservation, terminal outcome and late-callback fence.
- Core migration 059 and its registry/reopen tests add execution evidence without rewriting historical migrations.
  Emergency inventory includes both reservation-only and unpublished-plan effects.
- Shared template user, operation, status and single-child observation schemas define the operator surface once.
  Server dispatch is operator-only; explicit writes/recovery use `memory.operations.submit`. The two existing
  Desktop authority/onboarding mappings recognize the new availability reason; B3 Home is separate.
- Original label-consumer/Native files belong to their independent checker. Their indexes and the selected-group
  getter/runtime wiring are integrated here; this report does not replace their producer evidence or review.

## Current read contract

`memory.templates.derived` reads exactly one original `{ planId, bankId, childId }` with an already recorded
Native receipt. It checks the current reviewed connection, configuration clock, secret revision, authority,
Bank/namespace and the exact request/model/definition identities. Each await is followed by local revalidation.
The Native work is one compatibility read and one original refresh-result read, under one finite deadline.

An `observed` result has the actual successful read time in `observedAt`; it is not a Native completion time.
`stale` and `unavailable` have `observedAt: null` and no cached result. Lightweight status retains the historical
child observation with `source: rollout_record` and its original `verifiedAt`. Reads neither write SQLite nor
claim/renew execution, admit refresh/model work, automatically poll or sweep all plan children.

The shared lifecycle stop signal cancels both derived reads and previews. New reads after stop and delayed
transport continuations cannot access SQLite. Preview captures its local guard before its first compatibility
await, so configuration A-B-A during that call cannot become an admitted preview.

## Compatibility corrections

`template-runtime-selection.ts` now checks enrollment by the exact provider lineage, Bank ID and generation
before entering managed identity validation. Untracked legacy v1 Banks retain their existing runtime path.
A matched enrollment still requires the full canonical/stored identity, a valid before-image and the complete
receipt-backed selection; corrupt or missing managed evidence cannot fall back to the untracked branch.
The new 13-case `template-runtime-selection.test.ts` exercises the real legacy runtime, managed selection/group,
wrong incarnation, changed setup, missing base and corrupt stored identity without modifying the legacy fixture.

`memory-operation-template-guard.ts` checks for an active hold before reading complete authority evidence.
This restores the original query boundary when no hold exists. The check remains inside the operation owner's
synchronous transaction; same-plan recovery and independently validated W6 offline takeover retain their guards.
The original W6 test still requires unique evidence validation, both final synchronous plans and independent
post-COMMIT retirement. Its assertions and time bounds were not weakened.

Input 04 contains these two production corrections and the new test. Input 05 differs only in the condensed
`memory-authority-status.ts` module-contract comment; the matching folder index was also clarified. Executable
code did not change between the corrected runtime tests and the final input. Shared inputs stayed unchanged.

## Verification and retained evidence

| Evidence | Result |
| --- | --- |
| `b2-core-compatibility-01-result.json` / `-vitest.json` | Six files, 56/56, exit 0: 13 new cases and all 43 cases in the five previously failing runtime/W6 files; input 04. |
| `b2-core-runtime-remainder-01-result.json` / `-vitest.json` | Remaining 19 runtime/operation/W6 files, 142/142, exit 0; input 04. |
| `b2-core-managed-affected-01-result.json` / `-vitest.json` | Ten affected lifecycle/derived/operator files, 85/85, exit 0; input 05. |
| `b2-core-lifecycle-final-01-vitest.json` | Earlier 11-file 90/90 run. The four unchanged pure composition/integrity/storage/receipt files retain 45 valid cases; its other 45 are superseded by the affected rerun above. |
| `b2-core-migrations-final-01-result.json` / `-vitest.json` | Seven migration/registry/historical-reopen files, 41/41, exit 0. |
| `b2-core-shared-adjacent-01-result.json` / `-vitest.json` | Three Shared operation/authority/lifecycle schema files, 15/15, exit 0. |
| `b2-core-desktop-adjacent-01-result.json` / `-vitest.json` | Two previously authorized Desktop mapping files, 18/18, exit 0. |
| `b2-core-lint-final-01-result.json` | All 87 scoped source/test files pass ESLint, exit 0. The Shared public-entry limit remains 575. |
| `b2-core-typecheck-final-01-result.json` | Core typecheck, exit 0, against input 05. |
| `b2-core-desktop-typecheck-01-result.json`, `b2-core-cli-typecheck-01-result.json` | Desktop and CLI typechecks, both exit 0, against the frozen consumer inputs. |
| `b2-core-shared-typecheck-read-01.json` | Shared typecheck, exit 0; every Shared input remains unchanged. |
| `b2-core-source-format-03.json` | 101 files pass UTF-8/no-BOM, whitespace, module-contract and folder-index checks; tracked diff check passes and the seven label files plus lifecycle spec have no drift. |
| `b2-core-boot-process-01-result.json`, `b2-core-boot-01-result.json` | Real Node/main process exits 0 with `verified=true`; authenticated status, preview and derived dispatch pass, with zero prohibited network/provider calls. |
| `b2-core-boot-cleanup-01.json` | Actual startup shows migration head 59 and WS listening. PID 21984 stopped, port 8673 released, and the exact owned data directory was removed after path/reparse-point checks. |

The 43 old runtime cases in the first corrected batch and the remaining 142 cover the original 185-case matrix.
Do not add its failed first run or the 13 new cases to that 185 count. The 85-case managed rerun also supersedes
the original 40-case read batch; overlapping runs are not additional coverage. No full repository/Core-suite pass
is claimed. Native's seven-file consumer/HTTP fixture injects its materialized group directly and does not depend
on the changed runtime getter; the released Native/label source and evidence were preserved without an unrelated rerun.

Original failures remain retained: `b2-core-matrix-01.log` (44/47), `b2-core-typecheck-read-01.*` (TS4058, exit 2),
and `b2-core-runtime-adjacent-01.*` (157/185, exit 1). The explicit `AbortSignal` getter resolved declaration-safe
inference, and the compatibility/query-boundary corrections resolved all 28 runtime failures. Earlier format
records also remain: the long authority-status header was condensed, then the audit was corrected to recognize
main's existing leading ESLint comment; no main source or lint policy change was needed for that audit correction.

The boot used `.trellis/.runtime/stage5b-core-boot/owned-QQPILD`, a fresh five-entry directory, with Hindsight
disabled, fake unused model configuration, no dotenv and blocked external HTTP/socket admission. Status and
unavailable/unknown-plan refusals were tested; startup does not establish complete feature or manual acceptance.
Only that owned directory was deleted. The stdout and result/cleanup evidence remain in this research directory.

## Remaining review and stop point

No planned Core self-check, active check process or owned boot cleanup remains. Independent Core review has not
started; combined B2 acceptance and the whole-5B gate remain pending. Home and managed paired backup/restore are
later B3 obligations. Original/installed/manual acceptance is separate. Release source and the heavy-check slot,
then pause without dispatching a reviewer, starting B3, committing, pushing, finishing or archiving.
