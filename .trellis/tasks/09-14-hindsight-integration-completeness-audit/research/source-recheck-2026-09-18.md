# Current-code Recheck of Hindsight Integration Gaps

Date: 2026-09-18. Scope: the existing Hindsight completeness audit and its B7 prerequisites.
This records the owner's requested current-code recheck, followed by explicit authorization to update documents.
The recovered conversation is `01a0b01c-b8bb-7a32-a984-c24b25e8e59d`, inheriting
`01a0ab0e-3b18-7b81-bb8c-862cd5d1d53e`; the substantive request was to verify overall gaps against actual code.

## Method and conclusion

Inspected `H:/TakiAgent` on `main`, HEAD `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`, including modified and
untracked production files. Semantic search supplied paths; direct working-tree reads and exact caller searches
supplied conclusions. The fixed-model context explorer was unavailable; available-model delegates and direct reads
completed the review. Native backup code was also read in `H:/hindsight`.

The earlier overall conclusion holds: provider/runtime, import/proof and recovery foundations are implemented, but
complete first enablement, repeated authority switching and operator/administration journeys remain incomplete.
The [54-entry matrix](completeness-matrix.md) is a capability/requirement ledger, not 54 missing features.
The current continuation is overall gap/closure discussion, before resuming detailed B7 interaction design.

This was source review, not a test run, crash reproduction, model call, live deployment or authority transition.
No original user database or credentials were read. The historical B6 test counts, D81 failure and 1,835-file
fingerprint comparison retain their original dates and limits; none was rerun or refreshed here.

## Implemented foundations reconfirmed

| Capability | Current source evidence | Qualification |
| --- | --- | --- |
| Structured Local and Taki policy | `packages/core/src/memory/canonical-local-runtime.ts:59-71`; `packages/core/src/memory/canonical-local-subsystem.ts:26-48` | Canonical storage, sparse retrieval, maintenance, retention and Blocks exist. Actual owner-workspace activation was not inspected. |
| Hindsight runtime and prompt/tool integration | `packages/core/src/main.ts:166`, `:498`; `packages/core/src/memory/hindsight/hindsight-memory-runtime.ts:31-74`; `packages/core/src/harness/run-snapshot-capture.ts:61-73` | Runtime selection, Taki assembly and canonical tools are production-wired. Correct Bank/capability admission is still required. |
| Scheduled replica synchronization | `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:51-67`; `packages/shared/src/memory-replica-schedule-schema.ts:15-29` | Default configuration is automatic, with six-hour incremental and seven-day full reconciliation intervals. This is not D79 daily model review. |
| Durable Pending recovery | `packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:49-62`; `packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:52-104` | The scheduler's runner invokes recovery, not just a pull. Pull/replay/factual confirmation retains the Hindsight epoch. UI/manual control remains incomplete. |
| Native backup/restore | `H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py:50-94`, `:373-412`, `:439-490` | Native tables, including application artifacts, are covered by the native CLI. This is not the full Taki Core/control-state recovery package. |

## Remaining production gaps reconfirmed

Existing N/RT/O identifiers below refer to the linked topic reports in [the audit overview](README.md).

| Gap / matrix entries | Current-code result | Concrete evidence |
| --- | --- | --- |
| First Hindsight enablement; A10-A12 | Import/proof/promotion primitives lack a production start/resume/activate coordinator. Existing-instance setup alone does not activate authority. | `packages/core/src/server/methods/hindsight-cutover-methods.ts:21-33` registers status/verify only; O02/O03 and the caller search below. |
| Healthy return, subsequent re-entry and emergency takeover; A35-A37 | No complete reverse authority writer or admitted transition workflow. First promotion is not a general re-entry API. | `packages/core/src/db/hindsight-authority-repo.ts:79-96`; `packages/core/src/db/hindsight-cutover-run-repo.ts:111-124`; O05-O07. |
| Runtime replacement and queued writes; A38 | Startup selection exists; dynamic binding only covers Legacy to Canonical Local. General replacement, writer drain coverage and durable transition queue/replay remain missing. | `packages/core/src/memory/runtime-selector.ts:51-65`; fence details below. |
| New Character while Hindsight is active; A27 | Bank initialization is reachable through Local-only setup. Missing verified Character mapping can reject a Run before optional automatic Recall. | `packages/core/src/memory/hindsight/hindsight-setup-service.ts:115-136`; `packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:41-61`; N03/RT05. |
| Setup interruption and active configuration; A30-A32 | No ordinary recovery owner for orphaned busy setup; failed revalidation can leave old compatibility; active validation/rebind workflow is incomplete. | `packages/core/src/memory/hindsight/hindsight-setup-service.ts:82-89`, `:190-198`, `:229-255`; N05/N06/N08 and qualifications below. |
| Model configuration and overlay lifecycle; A23/A29/A33 | Model fields are loaded/fingerprinted, without a native configuration apply/read-back consumer. Fixed v1 template is not an independently versioned user-overlay lifecycle and does not configure extraction taxonomy. | `packages/core/src/config/hindsight-config.ts:26-35`; `packages/core/src/memory/hindsight/taki-bank-template-v1.ts:29-66`; N04/N07. |
| Operator controls and durable observation; A17/A21/A28/A34 | Home consumes maintenance counters/tidy, not a complete setup/sync/switch/admin controller. Reopening or attaching another client cannot discover those missing operation workflows. | `apps/desktop/src/windows/home/pages/operations/use-operations.ts:30-60`; `packages/core/src/server/methods/memory-status.ts:24-33`; O03/O04/O08. |
| Managed deployment, full recovery and staged upgrade; A39-A43 | Native CLI and receipt schemas are real foundations; the complete Taki helper/artifact/candidate workflows remain missing. | `packages/shared/src/hindsight-setup-schema.ts:55-68`; native CLI above; N09-N11. |

Production searches covered `packages`, `apps` and `scripts`, excluding tests, fixtures/testing helpers and Markdown.
`prepareHindsightCurrentBank`, `importHindsightCurrentBank`, `verifyHindsightCurrentBank`,
`fetchHindsightCurrentBaseline`, `importHindsightSource` and `promoteHindsightWithFence` had declarations but no
production callers. `promoteHindsightAuthority` is called by the unused fence wrapper.
Authority-table writes identify initial Local creation, B2 activation and first Hindsight promotion, not a healthy
reverse/re-entry/emergency transaction. This establishes missing shipped integration, not impossibility of custom scripts.

## Precision corrections

### Fence existence is not complete transition protection

- `packages/core/src/memory/legacy-migration/memory-authority-fence.ts:17-33` counts admitted calls, waits for them to
  drain and rejects new fenced calls. Its waiters do not persist incoming mutation intents or replay them later.
- `packages/core/src/memory/runtime-composition.ts:81-100` passes that fence to Legacy. The Canonical Local constructor
  at `packages/core/src/memory/canonical-local-subsystem.ts:22-48` receives no fence.
- `packages/core/src/memory/hindsight/hindsight-authority-promotion-service.ts:10-17` can quiesce the supplied fence,
  but its comment does not prove actual Canonical Local foreground/background writers enter it. It has no production
  caller in the searched boundaries.

Existing DB transaction, current-source coverage and epoch guards remain real. They must not be described as a
complete runtime drain, durable transition queue or repeated handoff. [O02/O05](transitions-and-operator-reachability.md),
A11/A38 and the B7 design now state this narrower boundary. C03/C07 must verify actual writer coverage and queue replay.

### Optional Recall fallback is not a no-wait or universal chat-availability guarantee

`packages/core/src/memory/hindsight/hindsight-memory-runtime.ts:52-74` resolves Banks and synchronizes before Run
capture. `packages/core/src/memory/automatic-memory-recall.ts:15-17` defaults to completion/cancellation rather than a
finite business deadline; its default shared budget is 1,024 tokens and eight results. Native/transport deadlines are
separate. `packages/core/src/agents/chat-agent.ts:274` awaits automatic Recall before foreground model work.

Optional automatic Recall failure can yield empty context after a valid Run admission. Missing Bank, capability or
required-pin evidence can reject the Run earlier. Availability fallback must not swallow policy/integrity refusal.
The current waiting path is deliberate; D83 retains any separately measured optimization work.

### Failed validation and setup disable have narrower meanings

Setup writes busy state before remote awaits. `requireIdle` refuses those phases, and boot does not install recovery
for an orphaned attempt. This is a static recovery gap; a test of retry after persisted failure is not a crash test.

Failed revalidation retains prior compatibility, while later setup checks its presence and matching local fingerprint.
That is a pre-mutation admission weakness. Template checks, independent B4 promotion gates and runtime capability
checks remain; this review did not reproduce wrong-authority activation against an incompatible server.

`validate/setup/llmHealth` require Canonical Local. `disable`, at
`packages/core/src/memory/hindsight/hindsight-setup-service.ts:153-160`, changes setup state only and does not require
Local or change Authority. Runtime refusal after configuration/secret drift does not prove rotation is permanently
unrecoverable; restart/reconstruction was not exercised.

## Scope and next discussion

- Same-Core authenticated connection/fan-out foundations exist. Desktop operator URL and packaged CSP remain local:
  `apps/desktop/src/hooks/use-operator-connection.ts:20` and `apps/desktop/src-tauri/tauri.conf.json:44`.
  A remote Hindsight endpoint is separate from remote-Core selection; D23/#29 remains deferred.
- Independent-Core shared-Bank coordination is unsupported/unverified, not an observed data leak or permission to
  replace ordinary same-profile incremental re-entry with a mandatory new Bank/full-copy workflow.
- D79-D83 remain after B7. D81's recorded hidden-source/visible-derivative failure remains unresolved; policy
  propagation differs from preservation of original transported fields.
- Discuss the missing operation owner, setup/Bank lifecycle, first enablement, repeated handoff/queue and recovery
  dependencies using [the closure cases](closure-plan.md). Keep real backup/restore prerequisites before replacement.
- U1 remains unanswered; the earlier R1 new-Bank/full-copy premise remains withdrawn. No new task, implementation
  activation, status change, commit or archive is implied by this documentation update.

## Interrupted-document-update verification (2026-09-18)

Recovered the source review and interrupted documentation update from session
`01a0b026-4516-7a62-a878-906a57822e11`. All eight intended documents were already written; 20 checks against the
recorded patch confirmed the replacement paragraphs, revised matrix/case rows and complete dated report.

Document validation passed: 58 local links resolve, 55 explicit source path/line anchors exist, the matrix retains
54 unique entries covering R1-R10, and the closure plan retains 16 unique acceptance cases. UTF-8 without BOM,
whitespace checks and the scoped Git diff check passed. Source-location checks do not revalidate runtime behavior.

The audit and B7 task metadata remain `planning`; this session did not activate a task. The historical audit-validation
and source-fingerprint records remain unchanged. No runtime test, live switch, original-data operation or manual
acceptance was performed. The next discussion remains overall gaps and their closure dependencies before B7 U1.
