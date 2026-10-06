# W5 Actual Embedding V2: Direct Windows Worker Custody

Status: diagnostic-only V2 delivered and checked. **Do not execute V1.** Its original source, reports, checks,
and manifest remain immutable; this report supersedes V1's claim that its sleeper test proved actual-worker
termination. No model, PostgreSQL, corpus clone, working-pair migration, or recovery was executed for V2.

## Confirmed blocker and bounded repair

The parent's harmless probe showed that `H:/hindsight/.venv/Scripts/python.exe` is a Windows redirector:
parent PID 38136 held PID 7096, while the script actually ran as PID 58904 with parent PID 7096. V1's parent/self
assertions therefore refuse execution, and killing only its held launcher cannot establish model-worker death.
V1's old sleeper test missed this because it never joined a child self-report to the held process identity.

NEW `w5-candidate-actual-embedding-v2.py` composes the immutable V1 parent/child, control, and model helpers.
Only V1's one diagnostic launch is adapted via a module-local subprocess facade; the global subprocess module
and all PostgreSQL calls are unchanged. It launches the real base interpreter directly and uses CPython's
locally verified `__PYVENV_LAUNCHER__` mechanism to retain the exact original venv. No manual site-packages or
PYTHONPATH substitution, generic process-tree kill, changed production timers, or model/SQL redesign is used.

The existing `pyvenv.cfg` names CPython 3.11.5 at
`C:/Users/55473/AppData/Local/Programs/Python/Python311`. That installation resolves through the current junction
to `G:/AppDataMove/PythonPrograms/Python311`. V2 pins the actual executable and venv config in its new manifest.
Its direct launch preserves `sys.executable = H:/hindsight/.venv/Scripts/python.exe` and
`sys.prefix = H:/hindsight/.venv`; the actual process image and canonical base prefix refer to the same base
installation. The launcher environment value is consumed during interpreter startup, before site initialization.
The existing clean-environment step can then remove it without changing the initialized venv.

## Small V1-to-V2 launch delta

This is the equivalent scoped delta, implemented by NEW composition rather than editing V1:

```diff
- Popen([venv_python, "-B", "-s", v1_entry, "--owned-job", job], env=clean_child_environment)
+ Popen([actual_base_python, "-B", "-s", v2_entry, "--owned-job", job],
+       env={**clean_child_environment, "__PYVENV_LAUNCHER__": venv_python})

- v1.child_entry(job)
+ verify_and_persist_worker_self_report(job)
+ v1.child_entry(job)
```

Before launch, `worker-launch.json` persists the parent PID, actual/logical executables, venv, and probe status.
The same held Popen handle now identifies the actual script worker. Before calling V1's child entry, V2 verifies:

- Actual `os.getppid()` equals the persisted parent, and the held PID equals actual `os.getpid()`.
- The exact executable and Windows creation-time identity equal the parent's `child.json` receipt.
- Actual/base/logical executable, `sys.prefix`, and canonical `sys.base_prefix` match the pinned environment.
- `sentence_transformers`, `asyncpg`, and `torch` resolve inside that venv's site-packages. `find_spec` obtains
  top-level origins without importing those packages; the handshake additionally asserts none was imported.

`worker-self.json` is durable before any V1 model/data entry. Handshake failures write a closed stage/error
receipt and refuse execution. The parent result includes the launch and self-report with
`directWorkerIdentityVerified`; absent proof cannot produce success. The cumulative V2 manifest is used by the
existing verifier and NEW actual-model result sink. All V1 encoding, offline/HF token isolation, migration,
preservation, 180-second initialization, 900-second outer watchdog, 60-second observation, 180-second collection,
and exact owned PostgreSQL stop behavior remains reused unchanged.

## Actual verification

Final raw evidence: `w5-actual-embedding-v2-final-checks/`. The last harmless worker self-report records:

| Evidence | Observed value |
| --- | --- |
| Parent PID | 48940 |
| Held PID / actual script PID | 33260 / 33260 |
| Process creation FILETIME ticks | 134356162255365864 |
| Actual executable | `G:/AppDataMove/PythonPrograms/Python311/python.exe` |
| Logical executable | `H:/hindsight/.venv/Scripts/python.exe` |
| `sys.prefix` | `H:/hindsight/.venv` |
| Package origins | All three under the same venv's `Lib/site-packages` |
| Model/native packages imported | None |
| Test initialization hard bound / measured watchdog interval | 0.2 seconds / 0.218 seconds |
| Actual worker after held-handle termination | Exited; independent query of self-reported PID refused as not live |

The worker runs only standard-library handshake code followed by synchronous sleep. It never imports a model,
starts PostgreSQL, accesses a corpus, or enters V1's execution branch. A later completion marker is absent.
The 0.2-second value belongs solely to this harmless regression; production diagnostic limits remain 180/900.

- Five V2 regressions PASS in 0.567 seconds: actual self-report/handle/venv/package join and death, direct base
  launch, launcher-only environment addition, parent mismatch refusal, and module-local V1 launch adaptation.
- Nineteen preserved V1 fake semantic regressions PASS in 4.853 seconds, including transparent production
  preparation with a fake encoder, offline failure, counters, dimensions, timing, PG refusal, and fallback.
  The one flawed V1 redirector sleeper test is explicitly excluded and replaced by V2's actual-worker test.
- Final Ruff, format, scoped ty, AST parsing, and no-argument entry PASS for both NEW Python files.
- All 269 V1 inventory entries were rehashed unchanged; V1 manifest SHA256 remains
  `877d8e4b0a0e59920f7b06a61a9dd4921638d5dca31aca1d12b703905ec56c49`.

The intermediate V2 check directory remains intact, including an initial two-diagnostic type failure for the
CPython-private `sys._base_executable` attribute. The final code uses explicit `getattr` plus string validation;
the final check passes without suppressions. Old runtime references were not reopened.

## Parent execution

Review the NEW wrapper, regression, cumulative manifest, and final digest. Invoke V2 only:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-actual-embedding-v2.py --run-reviewed-clone
```

The outer operator invocation may itself use the redirector; its live supervisor launches and holds the actual
diagnostic worker directly. Read the printed NEW job's `worker-launch.json`, `worker-self.json`, `child.json`,
and `result.json` together. This delivery establishes the local Windows launch/custody repair, not actual-model
timing, Native/HTTP headroom, migration acceptance, or authority recovery. Those remain parent execution gates.
