# Hindsight Recovery Evidence - Execution Plan

## Current state

- Owner-authorized scope: close B5 native-result/append recovery and independent cutover-evidence gaps with sufficient source
  justification, a clear minimal direction and upgrade-oriented Hindsight patch records. Authorization was received
  on 2026-09-07; do not treat the earlier scope question as still pending.
- Status: the routine provider/Taki implementation and independent source review are complete. All seven confirmed
  findings are closed; the source-witness candidate was withdrawn after actual SQL verification. Final native 69,
  Shared 396 and Core 2036 tests pass. The owner-approved actual Rust dependency/build gate and four generated-model
  contracts also pass. The completed cutover research is a separate proposal, not an implemented fence.
  Read `research/g1-routine-implementation.md` and `research/g1-validation-results.md` for current evidence and issues.
- Latest owner steering: G1's second option is accepted. Confirm routine writes after reliable native-result proof
  and local factual application; let derived maintenance finish later, with independent cutover gates retained.
  Before another grill question, read existing discussions and reuse settled rulings. [grill.md](grill.md) now indexes
  T5 decisions/kickoff, T4 G2-08, ADR 0009 and the parent PRD. No second product question is ready after that review.
  The owner approved continued implementation when technically ready; the selected protocol now meets that entry gate.
- The owner subsequently approved continuation when technically ready, including implementation and verification
  within the existing boundaries. Do not ask again for routine execution permission. Provider protocol narrowing and
  Taki transition/field review are complete; implementation must prove the listed native cases rather than repeat the grill.
  `research/g1-taki-consumer-and-field-map.md` records the consumer changes and separates unresolved B4/B6 field bindings.
- Current baselines and preserved source hashes are in `research/pre-followup-baseline.json`. Prior B5 changes and
  the unrelated Hindsight control-plane `bin/cli.js` edit must remain intact.
- `H:/hindsight/TAKI_PATCHES.md` preserves historical IDs 001-008 and tracks the actual candidate as ID 009.
  It is not yet accepted as a fully supported release. The old approximately 20-file strict option remains history.
- The prior B5 files are the baseline for the intentional G1 changes, not a claim that all 38 source hashes still match.
  The unrelated Hindsight `cli.js` and original migration 035 hashes were rechecked and remain identical.
- Native/SQLite, full Taki suites, reviewed native regressions, SDK behavior and canonical generation now have actual
  offline evidence. Repeated OpenAPI/Python/TypeScript/Go generation produced 455 byte-identical files and unchanged
  Go manifests. Final affected suites and scoped quality gates passed after review corrections; no live/manual gate
  is inferred. The full provider Windows typecheck retains 27 diagnostics in unchanged modules; changed sources pass.
- The owner approved the direct runtime edge to already-locked `regress 0.10.5` on 2026-09-08. The exact two-file
  patch is applied; all package versions/checksums remain unchanged. Actual-source release/locked/offline build and
  four generated-model tests passed in `d31d069c8e07`, independently reviewed. No G1 implementation/offline checks
  remain. Formal Git/task closeout and the parent/B4/B6/B7/live/manual work remain separate; do not restart planning
  or repeat routine approval/build requests.

The earlier research-only milestones preserved all 38 baseline source hashes and checked documentation/context
manifests without running production code. They are historical preparation evidence, superseded for current status
by the implementation and validation records above.

## Research outputs

Current implementation inputs:

- `research/g1-native-result-protocol.md` - selected extension/engine/streaming-part/native-result contract.
- `research/g1-taki-consumer-and-field-map.md` - state/hash/checkpoint transition and logical-field obligations.

The separate `research/g1-cutover-evidence-contract.md` report was completed on 2026-09-08 (29,375 bytes, UTF-8 without
BOM, read-back and size checks passed). It defines proposed finite producer proof and source-fence recovery, with
explicit B4, planned-switch and B6 responsibilities. No cutover producer, fence, promotion or live acceptance was
implemented by that research. Keep its new execution semantics separate from the active routine implementer's scope.

Preserved historical source reports, not the default implementation direction:

- `research/recovery-producer-contract.md` - minimum native transaction/task evidence and rejected shortcuts.
- `research/append-result-contract.md` - native append constraints, full-result witnesses and replay behavior.
- `research/implementation-footprint-and-upgrade.md` - exact code/schema/client/test surface and maintenance cost.

`design.md` now selects extension-first tracked admission/results plus native per-commit part receipts. Native public
retain parameters, streaming and background maintenance timing remain intact. No per-write source/MM work graph or
new atomic input bound is selected. The approximately 20-file option remains in the preserved planning snapshot.

G1 fixes the routine completion guarantee. Implement stable native results, exact append/part recovery and factual
checkpoint confirmation first, using the completed research. Keep the independent cutover proof and B4/B6 field
bindings explicit. Ask about an input envelope only if a demonstrated remaining protocol requires a new supported-scope restriction.
Do not ask again for cross-repository permission, full Local maintenance, single authority, safe replay or field fidelity.

Initial source findings require care: a native same-transaction outbox callback may be reusable, but derived task
submission is post-commit; native workers can consume additional writes or report success after best-effort failures.
Native append itself rejects disabled document-text storage. The design must distinguish these native constraints
from consumer gaps, and logical replica evidence from private index quality. It must not invent a fence from task
status/queue emptiness, silently change semantic processing, or force extra work merely to manufacture completion.

## Implementation sequence after source review

1. Validate the curated current manifests and activate the existing task under the owner's approval.
2. Dispatch one direct `gpt-6-astra / high` implementer; no recursive delegation. Start with typed/hash/transaction RED
   cases and the mutation witness, then tracked native preparation, exact streaming/delta/zero/Batch API part commits,
   immutable result pages and the Taki G1 transition. Preserve native algorithms, untracked behavior and existing edits.
3. Verify the complete routine slice with one independent `gpt-6-astra / xhigh` checker, including native/SQLite
   transactions, interruption/concurrency, old rows, backup/migration, exact build and canonical OpenAPI/SDK parity.
   The leader supplies the isolated PostgreSQL/generator environment; no live provider/LLM calls.
4. Handle the independent cutover-evidence slice without making it a routine-write dependency; preserve B4 current-Local
   completeness and B6 runtime/maintenance ownership. Record any still-unimplemented requirement honestly.
5. Update executable specs, live patch ledger, task/parent/HANDOFF and exact verification evidence. Do not claim full
   parent or live/manual acceptance from the routine slice or injected tests.

## Validation environment

Node 24.18.0, pnpm 10.22.0 and the existing Hindsight Python 3.11.5 environment are available. A clean child-process
probe started the bundled pg0 PostgreSQL 18.1 in an explicitly owned temporary data directory, connected through
asyncpg and found both vector and pg_trgm. The server was verified stopped; its owned data and registry were removed.
Tests can use this path without starting Docker or Hindsight. Disable Python dotenv loading and inherited real
credentials/DB URLs. Canonical generators ran with the pinned portable Windows toolchain; Docker was not started.
Tool versions, checksums, isolation and explicit SDK selectors are in `research/validation/README.md`. The Rust
runtime declaration described above was separately approved and passed its actual-source validation.

The leader uses the owner's explicit 30-minute wait intervals. Persist agent/command/process checkpoints before
context changes; resume existing work instead of duplicating checks after an interruption.

## Boundaries

- Work only in `H:/TakiAgent` and `H:/hindsight` for this task. Other worktrees and the protected legacy backup are outside scope.
- Isolated deterministic/fixture validation only; no current user data, live Hindsight/LLM calls or authority activation.
- No new dependencies, staging, commits, push, reset/rebase, finish/archive or live upgrade without separate authorization.
- Keep Hindsight semantic extraction/recall/consolidation ownership in Hindsight. Reuse native queues and transaction
  seams; do not build a second general workflow or semantic memory engine.
