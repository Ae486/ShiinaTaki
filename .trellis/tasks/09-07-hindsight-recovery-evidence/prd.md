# Hindsight recovery evidence and append mapping

## Goal

Enable reliable interoperability between Taki's complete Local memory system and Hindsight. Resolve B5's native-result
and append-recovery gaps under the accepted factual-write completion rule, while keeping cutover completion separate.
Prefer Taki adapters and
supported native APIs/extensions before adding source-justified generic producer hooks. Preserve Hindsight's native
semantic engine and make every necessary patch easy to locate, revalidate, replace or retire during upstream updates.

## Confirmed direction and review state

The owner's 2026-09-07 [design record](grill.md) confirms public logical field alignment, full Canonical Local
maintenance in B6, Hindsight-native semantic processing in Hindsight mode, adapter/extension-first integration,
and source-backed design optimization during development. These decisions apply before the older research proposal.

The owner accepted G1's second option: routine pending writes may complete after reliable native-result confirmation
and verified local factual application; observation/model work may finish later. Initial activation and healthy
provider switching keep their independent required-maintenance/completeness gates. The task is `in_progress` under
the owner's continuation approval. The routine producer/consumer candidate now has actual native/SQLite and SDK
evidence and has passed independent source review after closing seven confirmed findings. Final native 69,
Shared 396 and Core 2036 tests pass. The owner approved the Rust dependency patch on 2026-09-08; the actual-source
locked/offline release build and four generated-model contracts now pass. See `research/g1-validation-results.md`
for the precise offline/live boundary. The approximately
20-file strict proposal is historical; `design.md` and the G1 reports specify the selected protocol.

Before any further grill question, read the prior-decision index in `grill.md` and its relevant source record. Do not
re-ask settled requirements or ask the owner to choose an implementation detail that code/schema evidence can settle.

## Owner authorization and baseline

- On 2026-09-07 the owner approved this follow-up task and cross-repository changes, conditional on sufficient reasons,
  a clear modification direction, and maintained records of Hindsight-side changes for future upstream iteration.
- Worktrees: `H:/TakiAgent` on `main` at `c3f8bc4`; `H:/hindsight` on `main` at `7eca2056`.
- Preserve the reviewed, uncommitted B5 Wave 3 work. It passed Shared 392/Core 2016/CLI 47/Desktop 548, five TS
  typechecks, root lint, and isolated native startup through migration 035. This is a baseline, not this task's proof.
- Preserve the unrelated `H:/hindsight/hindsight-control-plane/bin/cli.js` edit and all other worktrees. Never inspect,
  traverse, modify, stage, or remove `.backup-memory-legacy-migration-live-20260821-01/`.
- Existing patch history is `TAKI-HS-001` through `TAKI-HS-008`, preserved in the archived compatibility task's
  `hindsight-patch-ledger.md`. Its historic acceptance must not be rewritten as fresh verification.
- `H:/hindsight/TAKI_PATCHES.md` is the live provider-side maintenance entry point. It preserves that historical
  inventory and tracks `TAKI-HS-009` as independently reviewed and verified offline; live gates remain separate.

## Confirmed gaps

The following describe the reviewed B5 baseline that motivated G1. Current candidate behavior and remaining review
findings are in the implementation/validation records; these baseline gaps are not a claim that the new code is absent.

- Hindsight's native retain completion and derived maintenance are distinct. Its native result still needs reliable
  operation/result identity and a committed factual boundary for local confirmation. Missing operation-scoped derived
  evidence is no longer a routine-write blocker, but independent authority-cutover completeness still needs proof.
- Native append exists, but the current B5 consumer cannot safely map an appended fragment to its resulting full
  document and fact set under concurrency/restart. Native retain IDs lack payload fingerprinting, and terminal
  operations can be pruned. Do not infer an unapplied write from a missing operation or silently change append to replace.
- Taki's reviewed unavailable completion port reflects the previous stricter rule; adapt it with a versioned, verified
  native-confirmation transition rather than blindly completing existing rows. The append refusal remains a real
  native-result/replay gap and may be removed only after verified producer-to-consumer evidence exists.

## Requirements

- Research the existing native task, retain, mutation, document, transfer, replication and official extension paths
  before choosing a design. For each proposed provider change, show why supported adapter/API/extension reuse cannot
  satisfy the required guarantee, and record the exact minimum hook. Field conversion alone is not such a reason.
- Reuse existing Hindsight semantic processing and task machinery. Routine confirmation covers native factual writes,
  with derived work continuing under native policy. Define the separate finite cutover evidence boundary without
  waiting for unrelated or indefinitely recurring work. Do not change automatic model-refresh timing merely to finish
  a routine pending row, or introduce another semantic engine/generic workflow framework.
- Survive native-commit/enqueue interruption, duplicate submission, task retries, worker restart, failure/cancellation,
  operation pruning and Bank lineage/generation changes without false success or duplicate memory application.
- Establish append input/result identity from source-backed document/fact witnesses and stable replay semantics.
  Prefer an existing supported API/identity path when it suffices; patch the provider only for demonstrated gaps.
- Bind producer evidence to native operation/request identity, outcome, Bank lineage/generation and an observable
  committed journal boundary. A consumer must reach that boundary before claiming locally reflected completion.
- Update the Taki Pending Memory client/runner to consume real producer evidence and support safe append recovery,
  retaining the existing Authority/Bank transaction guards, same-lease continuation, original identities and deadlines.
- Separate native write confirmation, replica application and derived freshness. Preserve honest unknown/failed native
  outcomes; derived status needs an actual producer or stays unknown. Zero pending writes cannot satisfy cutover proof.
- Maintain a discoverable Hindsight-repository patch ledger with stable IDs, baseline/version, reason, native versus
  Taki-specific responsibility, changed modules/API/migrations/generated artifacts, verification and upgrade/retirement
  checks. Link the preserved Taki history and current task evidence; keep one live ledger for subsequent provider patches.
- Public contract changes require canonical OpenAPI regeneration and all maintained generated clients, with relevant
  TypeScript/Python wrapper parity. Additive tables require dialect handling, backup/restore/transfer decisions and
  migration tests. Advertise compatibility only after the represented contracts pass their gates.
- Apply the Hindsight coding/review rules (typed models, engine-owned persistence/authentication, no new advisory locks)
  and Taki's Shared/Core contracts. Keep code, comments and engineering records in English, user communication in Chinese.

## Acceptance Criteria

The following are G1 offline development criteria, verified by the implementation, independent review and validation
records. They do not accept a live authority switch, real-model quality or the parent task's manual criteria.

- [x] The design names the source evidence, rejected weaker/overbroad alternatives, minimum patch surface and upgrade cost.
- [x] A stable native-result witness survives retry/restart and proves the original factual write and its committed boundary.
- [x] Append has a verified full-document/fact result mapping and idempotent recovery under concurrent writes and lost acknowledgements.
- [x] Actual Taki client/repository recovery consumes the new supported contract through the second-pull checkpoint fence.
- [x] Proven native writes complete after local application while derived work remains pending, without false derived
      freshness or weakening the independent authority-cutover gates.
- [x] Existing pending rows/receipts survive the changed completion contract without duplicate replay or automatic
      promotion of unknown native results; unavailable derived status alone no longer blocks new routine confirmation.
- [x] Unsupported/old/ambiguous producer state remains explicit and does not overwrite new authority or silently reapply memory.
- [x] Focused regressions, affected full suites, types/lint, migration/backup and OpenAPI/client generation checks pass offline.
- [x] Every provider change is traceable from the Hindsight patch ledger to its source/tests/schema and upstream-update checks.
- [x] Independent review, executable specs and task/handoff records distinguish implemented offline contracts from unrun live/manual gates.

## Out of scope

- Real user-data migration, current live Hindsight/LLM calls, paid resources, authority activation, or automatic failover.
- Semantic extraction/prompt/recall algorithm redesign, general job frameworks, broad UI work or unrelated refactoring.
- Staging, commit, push, reset/rebase, task finish/archive, or new dependency introduction without separate authorization.
- Rewriting completed B2/B0/Waves 0-2 evidence or silently treating this task as full parent/manual acceptance.

## Research and design work

The three reports under `research/` preserve source findings and an evaluated strict recovery design. The latest
[confirmed direction and open decisions](grill.md) requires reassessing that option against native reuse and actual
interoperability guarantees. Native transfer, extension packaging and fewer file edits do not by themselves prove
safe replay or derived completion. Conversely, ordinary data conversion does not require the whole strict proposal.

The atomic option would restrict the supported retain envelope and change tracked automatic model-refresh timing.
Neither effect is approved. Cross-repository authorization persists. G1 is decided and prior rulings have been indexed;
remaining field/protocol questions go to source investigation first. Reopen the grill only for a new concrete product
tradeoff that the accepted records cannot settle. Preserve historical research without presenting its older recovery
requirement as the current selected design.

## References

- [Confirmed interoperability direction and pending grill decisions](grill.md)
- [B5 independent review and precise source evidence](../08-09-memory-replica-sync-recovery/research/wave-3-review-2026-09-07.md)
- [B5 executable contracts](../../spec/backend/memory-replica-sync.md)
- [Existing patch history](../archive/2026-08/08-09-hindsight-compatibility-extensions/hindsight-patch-ledger.md)
- Live provider ledger: `H:/hindsight/TAKI_PATCHES.md`.
- [Authority and replica decision](../../../docs/adr/0009-single-memory-authority-with-local-replica.md)
- `H:/hindsight/AGENTS.md`, `CLAUDE.md`, and `.claude/skills/code-review/SKILL.md`.
