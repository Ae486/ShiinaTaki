# Canonical Local Runtime - Implementation and Verification

> Historical Local/raw-read slice checkpoint. The later [D77/B6 validation](d77-runtime-validation-2026-09-11.md) supersedes its remaining-Hindsight status; the original gate counts below remain historical evidence. Raw native schemas now live in Shared `hindsight-native-runtime-schema.ts`.

## Result and scope

The B6 Local runtime now performs real canonical ingestion, tools, automatic recall, policy/tidy, retention, Block
projection and pre-retirement flush. It uses the existing provider, per-Character maintenance chain, shared Utility Slot
and Core-owned Compaction. Legacy Markdown is not reactivated as canonical storage.

This record covers offline automated evidence in `H:/TakiAgent` on main, after the reviewed D78 base commit `3c63a80`.
It is not full B6 completion, Hindsight activation, provider-only D77 recovery or owner/manual acceptance. The one
[policy-readiness question](../grill.md) remains unanswered. Hindsight client work is recorded separately from Local
runtime verification; a raw native read method is not an installed authority provider.

## Implemented behavior

| Area | Observable result |
| --- | --- |
| Primary provenance | Exact committed Timeline identities/content/commit boundaries are witnessed durably; autonomous speech and inferred numeric ranges are not primary evidence. |
| Ingestion | One saved Write Gate and extraction plan produces original sources plus facts or lexical reinforcement; per-Bank receipts survive partial failure/restart. Ordinary work retains the existing 20-message cadence. |
| Late sources | Positive witnesses remain pending independently of the baseline/retirement cursor, so late completion cannot silently discard a source. A post-baseline source gap refuses retirement. |
| Prompt and recall | One admission-bound provider/capability/route capture supplies tools, RunSnapshot and bounded ephemeral automatic recall. Hidden/mood/retention rules apply; relationships remain complete and observed content is fenced. |
| Maintenance | Private revision-bound tools perform actual policy, reinforcement, source-preserving supersede/copy and Block updates. Retention counts committed effects; only declared machine rolling policy permits current-record hard deletion. |
| Store history | Migration 041 preserves preexisting receipt/snapshot bytes and historical replay, adds ingestion/witness state and prevents reuse of retired identities. Supported logical fields and typed metadata stay intact. |
| Activation failure | A committed marker irrevocably retires Legacy admissions even when construction, callbacks or marker reads fail; failed binding blocks Compaction retirement. Before-commit rollback preserves Legacy operation. |

Detailed executable signatures, constraints and assertion points are in
[Canonical Local Memory Runtime](../../../spec/backend/canonical-local-memory-runtime.md).

## Independent review corrections

The assembled slice received a separate source review and pure in-memory SQLite probes. Two additional findings were
reproduced before correction:

1. **Unchanged lifecycle receipt without a snapshot.** A supported source-free imported observation could successfully
   return `unchanged` once and then fail its identical retry with a missing-snapshot integrity error. The direct canonical
   repository now saves the referenced snapshot atomically with that receipt. Tests cover valid/invalidated imports,
   later revision changes and receipt-insert rollback; all three new regressions failed before the fix and passed after it.
2. **Cross-Bank supporting-memory exposure.** Moving one selected Character fact to Global also copied unselected pinned
   relationship supports as ordinary Global memories. Another Character could see them in assembly, BM25 and tidy input.
   Ancillary cross-Bank copies now remain hidden evidence, preserving the full source/support graph and original Bank.
   Default tidy excludes hidden rows and allows only captured references plus successful row-result references from the
   same pass. Five regression failures became green; same-Bank support and multi-step returned-reference editing remain valid.

The reviewer accepted this bounded correction; no persistent evidence marker or new classification mechanism was added.
Hidden duplicates retain their hidden policy when reinforced. Rolling deletion removes current records and collectible
sources but deliberately keeps historical snapshots/receipts; it is not full content erasure from history.

## Verification evidence

Logs for the initial gate, corrected full run and isolated boot are under `.trellis/.runtime/b6-quality-20260911/`.
They are execution artifacts, not tracked user data or a substitute for the assertions below.

| Gate | Result |
| --- | --- |
| Workspace TypeScript typechecks | All five packages passed. |
| Root ESLint | Passed. |
| Full TS suites, bounded to four workers per package | Final Core: 2563 tests / 340 files passed after all Local and native read-client corrections. Unchanged Shared 414, Desktop 548 and CLI 47 passed in the workspace run. |
| Late-source/cadence/restart follow-up | 64 focused tests passed; six added cases use real SQLite and a deterministic model substitute. |
| Direct lifecycle receipt correction | 25 repository/provider tests passed, including all three regressions. |
| Cross-Bank hidden evidence and tidy correction | 103 tests across nine related files passed; the original five failures are fixed. |
| Runtime/activation follow-up | 15 tests passed after the repository correction. |
| Rust clippy | `cargo clippy --offline --locked ... -- -D warnings` passed. |
| Rust tests | 171 library and 7 helper tests passed; no failed or ignored cases. |
| Real Node strip-only Core boot | Fresh Legacy and explicitly seeded Canonical Local fixtures both reached `ws server listening`, applied migrations 1-41, made zero provider requests and exited. |
| Task manifests, encoding and whitespace | Context validation, `git diff --check` and 128-file UTF-8/no-BOM/new-file whitespace audit passed. The long D77 research uses a bounded handoff to avoid injection truncation. |

The first unrestricted parallel test run had stale migration-tail expectations and one ZIP validation timeout under load.
Tail assertions were corrected for migration 041. The ZIP test passed in isolation and the complete four-worker rerun;
its timeout/assertions were not relaxed.

The boot harness uses a newly created owned directory, a loopback dummy endpoint and a restricted child environment.
It does not load `.env.local` or read the original user database. Both Core processes and test listeners were stopped.
Windows signal termination proves process exit, not graceful shutdown; graceful shutdown is not claimed by this smoke.

## Independent native read-client slice

`hindsight-runtime-client.ts` and `hindsight-runtime-contracts.ts` add `recallNative` and `reflectNative` through the
existing authenticated requester. Their factory is installed on `HindsightClient` as optional capability methods, so
existing setup/G1/D78 test clients and operation hashes remain unchanged. The native 0.9.0 request shapes include the
actual filter/include options; responses retain native null/omission, typed JSON, special own keys, evidence and real usage.
The two read endpoints classify HTTP 400/422 without a misleading Bank Template repair instruction.

The corrected client passes 68 focused client/transport tests, Core typecheck, scoped ESLint and direct Node strip-only
import. Root review of the final implementation and paired boundary tests found no remaining issue in this slice.
The final Core 2563-test run, all five workspace typechecks, root lint and two-mode boot above include the final correction.

Review exposed one recurring constraint-reuse problem: applying response-byte, snapshot-container and Canonical string
quotas to raw native read requests/results. Work paused for a complete request/response type audit, then the correction
was consolidated around actual native constraints. The adopted Shared query/token domain, Bank path validation and
response-byte bound remain separate. The contract and paired matrix are recorded in
[Hindsight Native Runtime Reads](../../../spec/backend/hindsight-runtime-reads.md).

All transport tests use injected responses; no Hindsight service or model was called. Canonical hydration, policy resolution,
replica integration and actual Hindsight MemoryProvider selection are still unimplemented and are not represented by these
raw client methods.

## Remaining boundaries

- Migration 041 is forward-only and was exercised on owned fixtures. For an actual rollout, back up the target database
  first and use the normal migration runner. A downgrade restores the complete pre-041 backup; do not delete migration
  receipts or selectively restore old tables. This slice adds no dependency, deployment environment key or native server
  endpoint, and does not authorize applying the migration to the original user database here.
- B6 stays `in_progress`. Hindsight still requires its real provider composition, exact-version D77 application-state
  projection, B5/Pending recovery wiring and narrow curator/flush integration. Raw B4 staging is not a canonical B5 reader.
- The owner policy-readiness answer is required before implementing that new-memory recall behavior. It does not reopen
  already accepted original-field preservation, Block ownership, Pending usability, G1 timing or native semantic ownership.
- No real model, original database migration, authority activation, push, task finish or archival was performed here.
- During recovery, a script-location search accidentally included historical D78 runtime directories. The search was
  narrowed to explicit paths; no historical artifact was modified. Subsequent execution used only fresh owned fixtures.
- A review sub-agent subsequently repeated an out-of-scope read of T4 task documents during context recovery. It reported
  read-only activity and was interrupted. The root completed the final raw-client correction review in the main workspace;
  no additional T4 access is performed to investigate that report.
