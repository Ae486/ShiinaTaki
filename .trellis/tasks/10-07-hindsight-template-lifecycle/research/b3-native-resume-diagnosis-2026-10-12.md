# B3 Native joint restore: recovered failure and focused fixture repair

Status: diagnosis complete; the two-scenario repaired joint gate is pending. This record does not accept B3 or
whole Stage 5B. Work remains within the owner's continuation through 5B and stops before 5C.

## Recovered context and source boundary

- Task: `10-07-hindsight-template-lifecycle`; Taki main `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`, Native main
  `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`, both verified live. Existing dirty work is preserved.
- Original root session `01a12aa6-e8fc-72d3-a76a-03f2194d2752` and Native readiness/implementation child sessions
  `01a12aa8-58fa-7332-a05e-dee9e6a2b47d` and `01a12ab0-2fe0-7ac3-818f-66cd7d65e3b1` supplied readable progress
  and readiness records. Child `01a12acf-6e29-70d3-98bf-29123efbd2fb` contains no readable assistant review result.
  Encrypted dispatch bodies are not recoverable context and do not establish independent acceptance.
- Current reads of the prior 938-source manifest identify only the two known joint Python fixtures and Native
  recorder as changed. All 958 generated/maintained artifact entries, including the actual Rust build output,
  retain their recorded bytes. No production or generated change is needed for this failure.
- The active implementation uses the task's PRD/design, dispatch/resume plans, Native implementation evidence,
  lifecycle/backup contracts, both repository instructions, and `diagnose`/`trellis-before-dev` guidance.

## Retained failure sequence

| Evidence | Actual failure boundary |
| --- | --- |
| `b3-native-joint-01-result.json` | Both scenarios failed while importing the Core seed: missing Shared public export. No Native Apply or paired restore. |
| `b3-native-joint-02-result.json` | Actual seed/Apply succeeded; Core capture rejected the compatibility-only fixture connection with `HINDSIGHT_BACKUP_READBACK_MISMATCH`. No CLI/COPY restore. |
| `b3-native-joint-03-result.json` | Exit 1, 140.646 seconds, two failures. Core capture and copy now completed; output construction failed at `b3-core-joint-entry.mjs:112` because the copied operation IDs did not contain the expected terminal semantic refresh ID. No archive/restore acceptance. |
| `b3-native-joint-diagnostic-04-result.json` | Exit 1, 131.682 seconds, one customized scenario failed at the same assertion. The targeted Native probe identified the actual exception and stored marker. |
| `b3-native-joint-04-result.json` | Exit 1, 86.797 seconds, two failures. Real refresh and Core prepare/capture/copy passed. The next Native assertion incorrectly compared history JSONB with raw generated text. |

Both joint-03 prepare logs and the complete retained pytest log were inspected before another execution. The
ranked hypotheses were Native refresh failure, missing Core terminal observation, and omission during copy.
The existing joint reproduction is the relevant seam; a new shallow test would not distinguish these causes.

## Exact diagnostic command and findings

Working directory: `H:/TakiAgent`.

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' '.trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-native-check.py' joint-diagnostic-04 'H:/TakiAgent' 'H:/hindsight/.venv/Scripts/python.exe' '.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py' --allow-http-fixture -- 'tests/native_results/test_template_backup_pair.py::test_actual_core_native_pair_restores_and_refuses_current_drift[customized]' -q --tb=short
```

Root granted one diagnostic slot with Core/Shared/Native frozen. The temporary test-local wrapper awaited the
unchanged `template_refresh.settle_failure`, then recorded only its original exception, traceback locations,
actual SQL result marker and fake-provider counts. It changed no handler result, assertion, timeout, admission
or production code. The probe has been removed from current source.

`b3-native-joint-cf5ba68980014d1aa68d6d81247f49b5-commands.json` records:

- `AssertionError: unexpected joint refresh provider fallback` from the test's own `AsyncMock`.
- Four `call_with_tools` awaits followed by one ordinary text `call` await.
- `reflect/agent.py:1100` rejects an early `done()` without retrieved evidence. At the configured last iteration,
  `agent.py:703` deliberately performs final text synthesis. The original fixture trapped that required phase.
- Native legitimately settled `state=failed`, with both result revision and payload hash null. Core cannot infer
  terminal semantic-marker membership from failed/null alone, so omission of that ID is correct. The stronger joint
  expectation requires a successful refresh; neither Core copying nor historical derived-observation semantics
  need to change.

The recorder reports `changedInputs: []` and owned TEMP removal. Owned PostgreSQL fixture
`taki-hindsight-g1-119892168c75` reports `Stopped`, `DataRemoved` and `RegistryRemoved` all true. The Core children
exited without timeout; the listener and fixture shutdown completed. Original failures remain immutable.

## Smallest repair and pending verification

Only `tests/native_results/test_template_backup_pair.py` changes for the fix: configure the installed mock provider
with the known refresh text, wrap its real `call` to count exactly one final synthesis, and assert the `reflect`
scope and usage-return contract. Keep real claim/execution/publication, completed marker/content/history,
original request/receipt/child binding, nonempty COPY rows, B2 sidecars, post-restore provider/embedding traps,
historical verification independence, and refused-preflight writer-start traps unchanged.

Both tool and final-text provider calls are recorded separately and in the total. This is deterministic fixture
generation, not a real-model or prompt-quality claim. Root approved the fixture repair after reviewing the actual
failure. Next: scoped Ruff/format and `joint-04` for both customized and removed scenarios under a new full-source
freeze. Native production, Core/Shared and generated clients remain unchanged by this repair.

## Joint-04: corrected provider, exposed history assertion

Both real refresh handlers completed and Core emitted staged output including the original refresh commitment.
`resume-ruff-04` and `resume-format-check-03` passed before this run. Every recorder reports unchanged inputs
and owned TEMP removal; Root independently reread all 2594 frozen inputs without differences. PostgreSQL
`taki-hindsight-g1-fc68cd43fab5` reported all three cleanup flags true.

The new failure is `InvalidTextRepresentationError: Token "Generated" is invalid` at
`template_backup_joint_helpers.py`'s history query. Migration `a7b8c9d0e1f2_split_history_into_own_tables.py`
defines `mental_model_history.content` as JSONB. `MemoryEngine._append_mental_model_history` writes
`{previous_content, previous_reflect_response}` from the old version, not the new text. The first real refresh
therefore has an empty-string/null before-image. The existing current-model content assertion already passed.

Root approved changing only that helper assertion to read the unique history row and compare its parsed complete
before-image. The completed-marker/revision/hash, current generated text, positive row counts and full physical
table equality remain. No migration or producer behavior changes. Joint-04 remains failed evidence, and the
next two-scenario joint run uses a fresh suffix after scoped lint/format and a new common freeze.

## Joint-05: host proxy selection blocked by the network guard

`b3-native-joint-05-result.json` records exit 1 after 303.142 seconds, two failed cases (pytest 128.55 seconds),
unchanged source inputs and owned TEMP removal. Both scenarios passed actual refresh completion, the complete
JSONB history before-image assertion, and Core prepare/copy. Their first Python HTTP refresh-result read then
entered `httpcore/_async/http_proxy.py` and was refused by `G1_FIXTURE_EXTERNAL_NETWORK_FORBIDDEN`. No CLI archive,
physical target restore or target preflight was reached. Original failures remain retained.

The ranked falsifiable causes were: (1) Windows system proxy fallback despite scrubbed environment variables;
(2) a fixture import reintroducing proxy environment variables; (3) listener lifetime/guard-instance mismatch.
Root authorized a no-network transport-selection comparison in the existing `clean_environment`, before any
source repair. `b3-native-joint-proxy-probe-01.json` records default `AsyncHTTPProxy`, explicit
`trust_env=False` selecting `AsyncConnectionPool`, and no proxy environment keys. No socket was opened and no
proxy value or credential was printed. Installed HTTPX delegates proxy discovery to `urllib.request.getproxies`,
whose Windows system fallback explains why environment scrubbing alone is insufficient.

Root then authorized exactly the two owned-loopback `httpx.AsyncClient` constructors in
`tests/native_results/test_template_backup_pair.py` to specify `trust_env=False`, with short isolation comments.
The production CLI already specifies this option. No production, shared harness, network guard, marker/history
assertion, paired-proof assertion or timeout was changed. The original joint test remains the regression seam;
the transport probe establishes the cause but is not paired-restore acceptance. Scoped Ruff/format checks and
the next two-scenario joint run await a new root grant and common source freeze.

Owned PostgreSQL `taki-hindsight-g1-19f840d1bd3a` reports `Stopped`, `DataRemoved` and `RegistryRemoved` true;
the captured owned Python/PostgreSQL PIDs were absent after completion. No restored database was created.
The read-only artifact recheck also confirms 958 generated artifacts, 12 maintained inputs, four generation
manifests and five original generator sources still match `b3-native-resume-unchanged-artifacts-01.json`.
This retains bounded canonical/SDK reuse only; B3 and whole Stage 5B remain unaccepted.
