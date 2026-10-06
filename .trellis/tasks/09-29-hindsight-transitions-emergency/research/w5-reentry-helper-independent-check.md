# W5 reentry helper independent check

## Verdict and scope

**PASS after checker fixes for the task-only helper gate.** The parent may start the first
zero-model reentry staging run with no maintenance approval. This is not a real reentry,
maintenance-budget or W5 acceptance pass. No real working pair, database, PG service,
HTTP endpoint or model was opened by this checker. All database-backed tests used temporary
SQLite files or synthetic Native storage adapters.

The implementation delivery manifest remains immutable:
`w5-reentry-helper-source-manifest.json`, SHA-256
`4845ddb26060e0de668822bf54b857d29ae9411c928351a4dcab5fa8219362af`.
Its original 17 file and 6 reference hashes were checked before review. Eight independent
script preimages are retained under `w5-reentry-helper-independent-preimages/`.
The final checked inventory is `w5-reentry-helper-independent-source-manifest.json`;
it supersedes the old helper source identities only for this checker's explicitly listed
changes. Old reports, logs, inventories and implementation preimages were not rewritten.

## Findings (fixed)

### 1. Inherited execution context outlived its approval owner

- File: `w5_reentry_gate.py`; regression: `w5-reentry-helper-independent-test.py`.
- Issue: resetting the parent's ContextVar did not clear a child task's inherited allowance.
  A detached child could dispatch after the approved `_execute_attempt` had returned.
- Fix: an execution context now shares a revocable permit object with its children. The
  owner revokes it in `finally` before resetting its own context. Sending checks that the
  permit is still live before reserving allowance or delegating a model request.
- Evidence: independently reproduced RED in `w5-reentry-helper-independent-red.log`.
  Final tests reject detached dispatch after success, exception and cancellation, leave
  the synthetic counter at 301, and accept a fresh reviewed permit afterward.

### 2. Missing or damaged per-Bank history could reset consumed allowance

- File: `w5_reentry_gate.py`; regression: `w5-reentry-helper-independent-test.py`.
- Issue: an existing empty ledger was accepted even when cumulative submissions had
  advanced past 301. Existence and nonnegative counters alone did not prove continuity.
- Fix: persist and check the ledger's SHA-256; verify exact identity fields and identity
  key; require reservations to cover at least cumulative submissions minus 301; require
  recorded plans to belong to the current new reentry transition and RETURN-anchored
  Bank/generation/lineage, with at most one recorded plan per Bank. Reserve before dispatch.
- Evidence: independently reproduced RED in the same log. Final cases reject absent,
  empty, regressed, hash-damaged, wrong-key and foreign transition/Bank/namespace history.
  Conservative reservations greater than actual submissions remain accepted.
- Compatibility: an old partial ledger lacking the new hash fails closed. No migration,
  reset or real ledger write was performed. The parent's supplied starting state is 301
  submissions with no reentry yet. `model-submissions.json` and the existing 402 latch
  remain authoritative; their module and all budget values are unchanged.

### 3. Staged success trusted a checkpoint instead of the current owners

- File: `w5_reentry_gate.py`; regressions: both Python test files.
- Issue: a checkpoint claiming `outcome_unknown` could pass pause audit while actual Core
  SQLite reported the operation completed. Native maintenance-row identity alone also
  omitted the current transition request owner and some plan bindings.
- Fix: after Node has stopped, the supervisor's pause audit opens Core SQLite with
  `mode=ro` and verifies the operation's unknown outcome, terminal timestamp, reentry kind
  and producer, the nonterminal transition's operation identity, and absence of a receipt.
  Native audit verifies incomplete maintenance, exact candidate/requirements/policy and
  request/delta bindings, then current fenced phase, attempt/fence, transition request hash,
  provider lineage and generation. A checkpoint is retained as an additional consistency
  check. `transitionRequestHash` is added to the review snapshot for this audit; approval
  `IDENTITY_FIELDS` are unchanged.
- Evidence: independently reproduced RED in `w5-reentry-helper-independent-pause-red.log`.
  Final tests reject checkpoint/SQLite disagreement and six Native current-owner mutations
  (phase, attempt, fence, request hash, lineage, generation), while the matching paused
  case passes and any submission after the snapshot is rejected.

### Additional narrow guards

- The Python checkpoint reader rejects unsupported version types or missing steps,
  journey version or submission-array shape, matching the Node helper's fail-closed intent.
- The HTTP gate rejects non-loopback hosts other than the exact reviewed model hostname.
  A raw IP previously skipped model accounting while potentially satisfying the lower
  socket allowlist. Synthetic foreign-host/raw-IP cases now make zero delegate calls.
- Existing Python fixtures include the real audit fields, a temporary Core outcome table,
  and the new permit representation. No production source, driver, supervisor, plan
  inspector, dependency, credential, budget, 301 anchor, lease, timeout or poll was changed.

## Verification

All new runs below were sequential. No broad Core test suite or workspace type check was
repeated; the earlier accepted combined gate remains a separate historical result.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Independent Python regressions | 6/6 PASS, 7.458 s; includes lifetime and history subcases | `w5-reentry-helper-independent-final.log` |
| Existing Python Native/helper regressions | 5/5 PASS, 22.221 s; includes six current-owner negative subcases | `w5-reentry-helper-check-native-final.log` |
| Node helper/Core tests, `--test-concurrency=1` | 10/10 PASS, 10.099 s | `w5-reentry-helper-check-node-final.log` |
| Python AST parsing | 5 files PASS | `w5-reentry-helper-check-quality-final.json` |
| Node syntax checks | 4 files PASS | quality JSON |
| Ruff lint and format checks | Gate, inspector and both Python tests PASS; unchanged supervisor `F,E9` PASS | quality JSON |
| CLI parsing | Supervisor and inspector `--help` PASS; operational commands were not run | quality JSON |
| UTF-8, no BOM and trailing whitespace | 9 scripts PASS | quality JSON |
| Combined source/spec/config preservation | 45 hashes unchanged | quality JSON |
| Independent preimages | 8 hashes unchanged | quality JSON |
| Original helper delivery/reference preservation | 23 entries checked; the 2 repaired originals match independent preimages, all other live entries unchanged | quality JSON |

Lint: **PASS** for applicable task-only Python checks; MJS syntax checks pass.
TypeCheck: **not newly run / not configured for these task-only Python and MJS helpers**.
The previously accepted five-workspace type-check and 166-test Core gate are not claimed
as new executions. Their checked production/spec/config source inventory is unchanged.
Tests: **PASS**, 21 test methods/cases plus the stated subcases. Python tests import the
real Native maintenance control flow with local LiteLLM metadata; storage, transport and
engine startup are substituted. Node tests use actual temporary Core SQLite and synthetic
Native transport. These do not certify real PG enumeration or model behavior.

The retained RED logs are deliberate reproductions, not unresolved final failures. Earlier
green/intermediate logs are retained alongside final results without replacement.

## Findings (not fixed) and accepted limits

No confirmed in-scope helper defect remains unresolved. The following are acceptance
boundaries, not a claim that the real stage already passed:

- The first actual Bank A plan and Bank B forecast still require the parent's stopped-pair
  audit. Later A and B approvals must be reviewed against actual plans and finite budgets.
  No approval or additional allowance was created here.
- Admission before the first claim, or recovery from an expired unadmitted preview, may
  fail closed where the existing producer cannot safely recover. Do not synthesize an
  attempt, rewrite a request or fabricate proof to bypass those accepted helper limits.
- The read-only inspector's remaining-call estimate uses its forecast batch size. It is
  not an upper bound or approval authority. The actual gate snapshot uses the current
  service configuration and exact policy hash; approve from that actual snapshot.
- W5 real reentry and W6-W8, manual/original-environment acceptance and overall closure
  remain incomplete. No Git or task lifecycle action was taken.

No `.trellis/spec/` update is needed: these are narrowly scoped test-helper controls,
recorded here with executable regressions. Production transition contracts and the
already accepted source/spec inventory remain unchanged.

## Parent's next stage

The parent supplied a completed RETURN with operation
`ce841c61-d207-4f51-b1fd-51cd42ed9d9e`, transition
`df47f32c-48a8-47bc-9792-2e24e8642084`, receipt
`e173dffd3612e5932f50a1df5ae7c1c1b4f7ee3d269dce9a11828debd77a8469`,
Local epoch `afb2053e-8bcd-4322-8573-0a447d560bb8`, stopped services, 301 cumulative
submissions, and no intervening Local edits or reentry. This checker did not reopen that
pair or independently refresh those runtime facts.

With that custody still valid, the reviewed first command is:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reused-native.py run --stage reentry --submission-cap 329
```

Omit `--maintenance-approval`. Expected evidence is an actual newly persisted Bank A
post-delta plan, Core `outcome_unknown`, matching incomplete Native maintenance and fenced
owner, supervisor `staged_pause` after clean shutdown, and exactly zero new model submissions
(cumulative count stays 301). A successful staging exit is not a completed transition.
Review actual A requirements, B forecast and headroom before selecting allowances. Then
resume the same transition with exact A approval, stop at actual B, review B, and resume
with B's separate approval while preserving A's history and completed work. Never fabricate
proof or reset the checkpoint, counters, latch or lease to reach the next Bank early.
