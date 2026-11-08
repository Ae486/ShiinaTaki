# P1-V: Boot readiness tests and current authority

## 1. Outcome

**Done.** Updated the five failing cases in `packages/core/src/boot/memory-transition-boot.test.ts`.
The original red run reproduced five failures and three passes; the final run passed all eight tests.
Core typecheck, file-scoped ESLint and `git diff --check` passed.
[run G:/taki-codex-work/tmp-v/red.log] [run G:/taki-codex-work/tmp-v/green.log]
[run G:/taki-codex-work/tmp-v/typecheck.log] [run G:/taki-codex-work/tmp-v/eslint.log]
[run G:/taki-codex-work/tmp-v/diff-check.log]

All seven requested scenarios remain covered. The three previously passing tests and the existing helpers
are byte-for-byte unchanged. No production source, existing helper, template/prompt file or leader-owned record
was edited. No service process was started. This result covers P1-V only, not the parent connected journey or
manual acceptance. [run G:/taki-codex-work/tmp-v/delta-audit.json]

The leader's substantive diagnosis is supported: ordinary status no longer reconstructs publication history;
independent full readers remain responsible for historical proof. The November 6 plan explicitly records both
the timing change and removal of the observation machinery.
[source .trellis/tasks/08-09-memory-operations-ui/research/validation-recovery-plan-2026-11-06.md:40]
[source .trellis/tasks/08-09-memory-operations-ui/research/validation-recovery-plan-2026-11-06.md:128]

One provenance correction: Git records the latest committed change to this test file as
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`, authored **2026-10-06 16:13:38 +08:00**.
The stated October 4 last-edit date is not established by that evidence; the exact uncommitted editing date
is UNKNOWN. Work ran on `main`, HEAD `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`, preserving the inherited dirty tree.
[run G:/taki-codex-work/tmp-v/provenance.log]

## 2. Changes

| File / artifact | Purpose |
| --- | --- |
| `packages/core/src/boot/memory-transition-boot.test.ts` | Five cases updated, plus imports for `ZodError` and the existing production `createMemoryStatusObserver`; 67 inserted / 24 removed lines. |
| `.trellis/tasks/08-09-memory-operations-ui/research/boot-readiness-tests-20261107.md` | This requested report. |
| `G:/taki-codex-work/tmp-v/baseline/memory-transition-boot.test.ts` | Baseline copy checked against the assigned file before the first edit. SHA-256 `f3cf2698d5c508bb2af09d20606e0cf9056219d9ec0a30302e13301b8e118c60`. |
| `G:/taki-codex-work/tmp-v/p1v.patch` | Exact test delta. Reverse applicability checked without applying it. |
| `G:/taki-codex-work/tmp-v/receipt-boundary-probe.mjs` and `readiness-boundary-probe.mjs` | Disposable diagnostic scripts calling real Core entry points over the existing isolated harness. |
| `G:/taki-codex-work/tmp-v/audit-delta.py`, JSON results and logs | Reproducible checks, baseline comparison and fixture disposition. |

[run G:/taki-codex-work/tmp-v/p1v.patch] [run G:/taki-codex-work/tmp-v/delta-audit.json]
[run G:/taki-codex-work/tmp-v/patch-check.log]

Assertion changes below refer to original lines in the saved baseline and final source lines in this working tree.
The real full-proof call is `h.runtime.verifyTransitionPublication(receiptId)`, which wraps
`readVerifiedTransitionPublication` and performs matching-binding invalidation. Its implementation is not mocked;
the added spies use their original implementations. [source packages/core/src/memory/runtime-authority-verification.ts:46]

| Original assertion | New assertion / location | Reason |
| --- | --- | --- |
| Line 87: `expect(verification).toHaveBeenCalled()` after valid Local status | Status calls neither native verification nor the full reader; explicit `verifyTransitionPublication` returns the correct receipt and calls both. [source packages/core/src/boot/memory-transition-boot.test.ts:89] | Status reads current identity; the explicit reader proves history. |
| Line 90: changed receipt makes status throw `MEMORY_TRANSITION_PROOF_INVALID` | Same status call throws `MEMORY_TRANSITION_STALE`, without full reconstruction. [source packages/core/src/boot/memory-transition-boot.test.ts:96] | The current receipt/publication identity join owns this refusal. It does not need historical native evidence. |
| Line 98: corrupt native evidence makes status throw | Status remains `ready` before full validation and does no proof work; the explicit live-owner full reader throws `ZodError`, withdraws the binding, and subsequent status reports `unavailable` without rereading proof. [source packages/core/src/boot/memory-transition-boot.test.ts:108] | Historical-only corruption is detected at the full boundary; known invalid authority cannot remain usable. The existing `{}` damage is specifically a schema failure. |
| Line 126, all four Hindsight cases: `expect(classify).toHaveBeenCalled()` after warm status | Warm transition status and current evidence status call neither source classification nor the full reader. A successful explicit full read occurs before these observations. [source packages/core/src/boot/memory-transition-boot.test.ts:143] | Removes the obsolete observation-store expectation while retaining genuine proof and warm-read coverage. |
| Line 137, deleted application checkpoint: transition status throws | Production current evidence status reports `evidence_invalid` with null replica/Pending evidence; `operations().assertConnection()` throws `MEMORY_TRANSITION_PROOF_INVALID`; binding presence is unchanged by those reads. Explicit full verification also rejects and withdraws it. [source packages/core/src/boot/memory-transition-boot.test.ts:165] | Current checkpoint consumption must fail immediately. Transition progress observes binding publication, while current evidence status consumes checkpoints. |
| Line 137, changed native-pair cursor: transition status throws | Same current-evidence and data-guard assertions as the deleted checkpoint, followed by full-proof rejection and withdrawal. [source packages/core/src/boot/memory-transition-boot.test.ts:166] | Checkpoint advancement must preserve the actual native/application pair. Incrementing only the native cursor violates that join. |
| Line 137, deleted preparation: transition status throws | Ordinary status does no history reconstruction and current evidence status remains valid; explicit full verification throws `MEMORY_TRANSITION_PROOF_INVALID`. [source packages/core/src/boot/memory-transition-boot.test.ts:169] | Preparation is a retained W3 proof dependency, not current checkpoint data. |
| Line 137, corrupt delta result: transition status throws | Ordinary status does no history reconstruction and current evidence status remains valid; explicit full verification throws `ZodError`. [source packages/core/src/boot/memory-transition-boot.test.ts:174] | The retained delta document must be parsed at full validation; `{}` is rejected by its schema. |
| No corresponding post-full-failure assertions in the four-case matrix | Assert binding absence, transition runtime `unavailable`, current evidence status `authority_invalid`, and no repeated full reader on those subsequent observations. [source packages/core/src/boot/memory-transition-boot.test.ts:175] | Proves owner-scoped invalidation and prevents status from hiding a known failed proof. |

The Local snapshot no-call assertion remains and now spans the complete post-transition test segment without
clearing its history. Corruption SQL retains the original mutations and now runs in the Database wrapper's
transaction API. Schema/FK/setup failures are outside the expected-throw callbacks and therefore cannot pass
as validation failures. [source packages/core/src/boot/memory-transition-boot.test.ts:96]
[source packages/core/src/boot/memory-transition-boot.test.ts:152]
[source .trellis/spec/backend/memory-transition-publication.md:103]

## 3. Evidence and checks run

### Contract and scenario table

Read the requested project law, backend index, task PRD/implementation plan, performance investigation,
November 6 validation/recovery plan, publication/current-state/healthy-driver specs, and their applicable
current-authority/status contracts before editing. The publication spec explicitly designates
`memory-authority-validation.md` as authoritative for the November 6 correction.
[source .trellis/spec/backend/memory-transition-publication.md:64]

Failure expectations were established before editing: reject changed current receipt identity; reject consumed
checkpoint corruption immediately; reject historical corruption at independent full validation; withdraw only
the matching binding on its full-proof failure; do not reconstruct history during unrelated status reads.
No requested corruption scenario is assigned to **nothing**.

| Scenario | Required boundary and contract | Observed and retained assertion |
| --- | --- | --- |
| Present binding, valid proof | **Status/readiness** may report ready using current identity and actual binding state. **Boot/binding construction and explicit full proof** independently verify history. "Status ... does not prove history on every poll." [source .trellis/spec/backend/memory-authority-validation.md:38] [source .trellis/spec/backend/memory-authority-validation.md:64] [source .trellis/spec/backend/memory-authority-validation.md:100] | Actual transition status is ready without native/full-proof reconstruction. Explicit full reader returns the correct receipt. |
| Selection marker points at another receipt | **Status/readiness current identity join** must refuse; no historical reconstruction is necessary. Receipt is part of stable identity; changing it invalidates a bound runtime, and missing/malformed identity is an explicit status failure. [source .trellis/spec/backend/memory-authority-validation.md:27] [source .trellis/spec/backend/memory-authority-validation.md:35] [source .trellis/spec/backend/memory-authority-validation.md:102] | The retained all-zero receipt mutation produces `MEMORY_TRANSITION_STALE` through `service.status`. The current operator selection joins marker/publication/receipt/epoch. [source packages/core/src/memory/transitions/transition-operator-actions.ts:22] |
| Corrupt stored native evidence | **Explicit full-proof reader**, also **boot/binding/recovery**. "Historical-only document corruption is discovered at full-validation boundaries"; the full publication reader reconstructs native proof. [source .trellis/spec/backend/memory-authority-validation.md:58] [source .trellis/spec/backend/memory-authority-validation.md:64] [source .trellis/spec/backend/memory-transition-publication.md:124] | Current-only status remains readable. The real live-owner full reader rejects `{}` with `ZodError` and withdraws the Local binding. |
| Deleted Hindsight application checkpoint | **Status that consumes current checkpoint evidence and ordinary data guards**, plus **full proof / construction**. Current checkpoint consumption rejects missing/invalid data; evidence observation reports `evidence_invalid` without read-side retirement. [source .trellis/spec/backend/memory-authority-validation.md:54] [source .trellis/spec/backend/memory-authority-validation.md:91] [source .trellis/spec/backend/memory-authority-validation.md:115] [source .trellis/spec/backend/memory-operations.md:77] | `createMemoryStatusObserver(...).readRuntime()` reports `evidence_invalid`; real `operations().assertConnection()` rejects immediately. Explicit full proof rejects and then status reports `authority_invalid`. |
| Changed native-pair checkpoint cursor | **Current checkpoint-consuming status/data guards**, plus **full proof / construction**. Current pairing and saved floors remain required; only legitimate paired advancement is allowed. [source .trellis/spec/backend/memory-authority-validation.md:38] [source .trellis/spec/backend/memory-authority-validation.md:54] [source .trellis/spec/backend/memory-transition-publication.md:85] | The native-only increment produces the same current-evidence/data refusal as checkpoint deletion. Full proof also refuses the unequal pair. |
| Deleted preparation | **Explicit full-proof reader**, also **boot/binding/recovery**. Full publication verification reconstructs the complete W3 candidate; retained preparation evidence belongs to that history. [source .trellis/spec/backend/memory-transition-publication.md:48] [source .trellis/spec/backend/memory-transition-publication.md:124] [source .trellis/spec/backend/memory-transitions.md:253] [source .trellis/spec/backend/memory-authority-validation.md:58] | Current evidence remains valid; full reconstruction throws `MEMORY_TRANSITION_PROOF_INVALID`, then withdraws the Hindsight binding. |
| Corrupt delta result | **Explicit full-proof reader**, also **boot/binding/recovery**. Final reentry proof binds the actual delta-result hash; complete W3 reconstruction remains mandatory at full boundaries. [source .trellis/spec/backend/memory-transitions.md:168] [source .trellis/spec/backend/memory-transition-publication.md:124] [source .trellis/spec/backend/memory-authority-validation.md:64] | Current evidence remains valid; parsing the stored `{}` delta result at full verification throws `ZodError`, then withdraws the Hindsight binding. |

For all matching selected-proof failures, withdrawal and `authority_invalid` are mandatory.
[source .trellis/spec/backend/memory-authority-validation.md:68]
[source .trellis/spec/backend/memory-authority-validation.md:118]

The B4 `markReady`/promotion contract also requires selected certificate/raw checkpoint evidence, including empty
Banks. It is a separate boundary from post-transition observation and does not reintroduce historical proof on
every status poll. [source .trellis/spec/backend/memory-current-state-cutover.md:104]

### Commands and results

All runtime probes and requested checks used these process-local variables:

```powershell
$env:TEMP = 'G:/taki-codex-work/tmp-v'
$env:TMP = 'G:/taki-codex-work/tmp-v'
```

Environment: Windows PowerShell, Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`.
[run G:/taki-codex-work/tmp-v/provenance.log] [run G:/taki-codex-work/tmp-v/green.log]

| Command | Result / artifact |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/boot/memory-transition-boot.test.ts --pool=threads --maxWorkers=2` before editing | Exit 1; exactly 5 failed / 3 passed; failures at original lines 87 and 126. 21.78 s total, 15.55 s tests. [run G:/taki-codex-work/tmp-v/red.log] |
| `node G:/taki-codex-work/tmp-v/receipt-boundary-probe.mjs` | Exit 1 from the first diagnostic script's uncaught, correctly produced `MEMORY_TRANSITION_STALE`; this disproved the suspected missing receipt check. It was a probe expectation issue, not a production defect. Fixture removed. [run G:/taki-codex-work/tmp-v/receipt-boundary-probe.json] |
| `node G:/taki-codex-work/tmp-v/readiness-boundary-probe.mjs` | Exit 0; valid proof, changed receipt, native evidence, both checkpoint cases, preparation and delta all observed through real entry points before the test edit. All five fixture roots removed. [run G:/taki-codex-work/tmp-v/readiness-boundary-probe.json] |
| Same Vitest command after editing | Exit 0; 8/8 passed. 26.14 s total, 18.11 s tests. [run G:/taki-codex-work/tmp-v/green.log] |
| `pnpm --filter @taki/core typecheck` | Exit 0; `tsc --noEmit`. [run G:/taki-codex-work/tmp-v/typecheck.log] |
| `pnpm exec eslint packages/core/src/boot/memory-transition-boot.test.ts` | Exit 0; no diagnostics. [run G:/taki-codex-work/tmp-v/eslint.log] |
| `git diff --check -- packages/core/src/boot/memory-transition-boot.test.ts` | Exit 0. [run G:/taki-codex-work/tmp-v/diff-check.log] |
| `git diff --output=G:/taki-codex-work/tmp-v/p1v.patch -- packages/core/src/boot/memory-transition-boot.test.ts` | Saved the exact test delta. [run G:/taki-codex-work/tmp-v/p1v.patch] |
| `git apply --check --reverse G:/taki-codex-work/tmp-v/p1v.patch` | Exit 0; check only, no patch applied. [run G:/taki-codex-work/tmp-v/patch-check.log] |
| `python G:/taki-codex-work/tmp-v/audit-delta.py` | Exit 0; three passing test blocks and helpers byte-identical, eight cases retained, UTF-8 without BOM, no remaining fixture directories. [run G:/taki-codex-work/tmp-v/delta-audit.json] |

Installed Vitest matcher signatures and Zod's exported error type were checked before adding the assertions;
the standalone probes' Date-only timer API was checked against installed Node declarations.
[source node_modules/.pnpm/@vitest+expect@4.1.10/node_modules/@vitest/expect/dist/index.d.ts:534]
[source packages/core/node_modules/zod/v4/classic/errors.d.ts:20]
[source node_modules/@types/node/test.d.ts:1994]

No Core child, Native, PG, journey or model endpoint was started. The existing harness uses deterministic transport
envelopes; an unprogrammed native endpoint throws. In-process composed runtimes and observers were stopped/closed,
and their G: SQLite directories were removed by their existing cleanup. There are no owned service ports or service
processes to leave running. No original user data, credential entries or unrelated services were accessed.
[source packages/core/src/testing/memory-transition-healthy-transport.ts:48]
[run G:/taki-codex-work/tmp-v/readiness-boundary-probe.json]
[run G:/taki-codex-work/tmp-v/delta-audit.json]

## 4. Trade-offs

- **Detection timing is explicit:** historical-only damage can remain undiscovered during ordinary status reads
  until full validation. Current checkpoint consumption still fails immediately. This is the approved existing
  behavior; the tests now document its cost rather than adding a cache or silently dropping detection.
  [source .trellis/spec/backend/memory-authority-validation.md:58]
- **Two status responsibilities remain distinct:** transition progress can show a published target while current
  checkpoint evidence status reports `evidence_invalid`. Neither observation authorizes data access; the data guard
  also refuses. Full-proof failure subsequently makes the binding unavailable. Both status entry points and the
  data guard are exercised, avoiding an empty-evidence success assertion.
  [source .trellis/spec/backend/memory-operations.md:70]
  [run G:/taki-codex-work/tmp-v/readiness-boundary-probe.json]
- **Use the existing live-owner full reader:** it adds matching-binding withdrawal around the unchanged pure
  reader, as the live-runtime contract requires. Pure copied/offline readers remain independent; no new helper
  or validation abstraction was added. [source .trellis/spec/backend/memory-authority-validation.md:64]
  [source .trellis/spec/backend/memory-authority-validation.md:79]
- **More verification within the same eight cases:** positive full reads and post-failure owner/status assertions
  add test work. Existing test timeouts, production leases and deadlines are unchanged. Red/green wall times are
  check evidence, not a controlled performance comparison; green overlapped static checks.
  [run G:/taki-codex-work/tmp-v/p1v.patch]

## 5. Open items / UNKNOWN

- No P1-V implementation or requested check remains open. No spec-required detection gap was found in the seven
  retained scenarios after checking their actual owning boundaries.
  [run G:/taki-codex-work/tmp-v/readiness-boundary-probe.json] [run G:/taki-codex-work/tmp-v/green.log]
- UNKNOWN here: the leader's concurrent connected-journey outcome, real Native/model behavior and owner UI/manual
  acceptance. Those were not run or inferred from this suite. Separate boot-process corruption coverage was not
  added; these changed assertions use the explicitly permitted full-proof reader and current status/data boundaries.
- UNKNOWN: the original filesystem editing date of the old tests. Git establishes the October 6 committed change,
  not an October 4 last edit. [run G:/taki-codex-work/tmp-v/provenance.log]

## 6. Anything outside scope noticed

`memory-transition-healthy-drivers.md` still describes a separate verified observer with byte-matched cross-read
projection reuse at lines 31-38; its admission paragraph also mentions observer contexts at lines 159-160.
Those passages are stale relative to the authoritative November 6 correction and the explicit removal record.
They were not edited because the assignment's write boundary excludes specs. The precedence is explicit, so this
did not require weakening tests or changing production code.
[source .trellis/spec/backend/memory-transition-healthy-drivers.md:31]
[source .trellis/spec/backend/memory-transition-healthy-drivers.md:160]
[source .trellis/spec/backend/memory-transition-publication.md:15]
[source .trellis/spec/backend/memory-transition-publication.md:64]
[source .trellis/tasks/08-09-memory-operations-ui/research/validation-recovery-plan-2026-11-06.md:128]
