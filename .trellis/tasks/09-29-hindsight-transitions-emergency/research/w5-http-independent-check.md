# W5 genuine HTTP diagnostic independent check

Date: 2026-10-05. Reviewer: existing `w5_postpatch_review` agent.
Scope: the NEW HTTP diagnostic delivery only. Parent owns actual model/corpus execution.

## Verdict

**PASS after one report-integrity repair.** Final Windows custody verification passed against the exact
checked v2 source below. The parent may execute exactly one already-approved fresh actual-model HTTP clone.
This is diagnostic implementation acceptance, not W5 or manual/working-pair acceptance.

## Findings (fixed)

- File: `w5-http-diagnostic.py`, `finish_reports`.
  Issue: matching child/Node reports could retain true success/budget flags while the actual persisted
  `publicMilliseconds` was 60000 or absent, `exactLookupMatches` was false, or `applyPosts` was two.
  The independent test started from this review's genuine PG/uvicorn/Core HTTP result. All four altered
  reports were incorrectly accepted. The four RED results are retained in
  `w5-http-independent-checks/report-red.json`.
  Fix: the final result additionally requires `httpEvidenceComplete`: a finite non-boolean numeric
  `0 <= publicMilliseconds < 60000`; returned/completed apply and matching lookup; exactly one integer
  claim and apply count; valid request/result digests; input-file digest agreement; and matching SQL
  receipt request/result hashes and mapping/artifact counts. Persisted transport events must be completed,
  have a real 2xx integer status, contain exactly the claim/apply POSTs and one delta GET, and agree with
  the counters. Missing, malformed or contradictory fields fail closed.
- File: `w5_http_composition.py`, post-drain SQL receipt observation.
  Fix: add the actual parsed receipt's `request_hash` to `persistedDelta`, alongside its result hash and
  counts. The existing equality check now binds all four values to the Node HTTP result.
- Files: `test_w5_http_diagnostic.py`, `w5_http_inventory.py`, `w5-http-client.mjs`.
  Fix: make the synthetic report fixture provide the newly required evidence, and direct both verifiers
  to the NEW checked v2 manifest. No Core client, engine/router/auth behavior, timer or production source changed.

The 25 final independent report cases cover the original four counterexamples plus negative/string/null/
NaN/infinite/boolean duration, incomplete apply, duplicate/boolean/missing counts, request/result digest and
SQL proof mismatches, missing input or wrong input digest, extra/incomplete/malformed transport events, and
HTTP 503 or missing status. Every case first asserts acceptance of the unaltered complete fixture evidence.

The only initial lint failure was an unused import in this review's newly created test; it was removed.
Its initial Ruff output is preserved separately. No unrelated source or spec rewrite was needed.

## Findings (not fixed)

No confirmed source defect remains in the reviewed scope. Actual cached local embedding/reranker readiness,
complete real-corpus HTTP timing, subsequent maintenance, working-pair recovery and W5/manual acceptance are
execution/acceptance gates, not claims made by this check.

Node startup admission remains a strict 10-second gate. This review observed 5.969 seconds on the delivered
source and 9.203 seconds on both the first and final checked source, leaving only 0.797 seconds in the latter runs. These
observations demonstrate variability; neither a previous faster result nor this check guarantees admission
in the parent run. The limit is unchanged, and an actual timeout must fail without POST retry.

## Verification

All commands ran from `H:/TakiAgent` using existing installed tools. The NEW
`w5-http-independent-checks/run_checks.py` records exact argv, cwd, subprocess timeout, stdout/stderr, exit
code and elapsed time in the corresponding JSON. The table distinguishes independent execution from the
implementation's historical evidence; counts overlap and must not be added together.

| Independent execution | Result | Evidence |
| --- | --- | --- |
| Delivered offline Python tests plus NEW Windows/process and continuous-timer checks | 71 PASS, 1 explicitly owned-PG skip; 102.58s pytest | `python.json` |
| Actual Core client/socket suite, including in-call conditional capability GET, delayed body timeout, no retry/lookup after failure, corrupt proof and bounded response | 6 PASS; 3.266s Node test duration | `node.json` |
| One fresh owned PG + genuine MemoryEngine/app/auth/uvicorn + genuine Core client; deterministic models only | 1 PASS; 43.71s pytest | `owned-pg.json`, `fixture-wiring.json` |
| Four original contradictory-report regressions before repair | 4 expected FAIL; false success reproduced | `report-red.json` |
| Final affected persisted-report regressions, including all 25 independent cases | 79 PASS; 15.33s pytest | `affected.json` |
| First checked seal, actual Windows original Popen handles and actual final-client source verification/admission; timeout cleanup | 2 PASS; 52.79s pytest; admission 9.203s | `custody-checked-v1.json`, `windows-handshake-checked-v1.json` |
| Final checked v2 seal Windows custody and admission | 2 PASS; 50.67s pytest; admission 9.203s; final 5084-entry Python verification agrees with both Node source reports | `custody-checked.json`, `windows-handshake.json` |
| Scoped Ruff check/format, ty for the three Python runtime modules, both JS syntax checks, explicit scoped ESLint recommended rules | PASS, all exit 0 | `ruff.json`, `format.json`, `typecheck.json`, `syntax-*.json`, `eslint.json` |

JSON evidence paths in the table are relative to `w5-http-independent-checks/`.

The owned PG was `taki-hindsight-g1-d63d7c8f3454`. Its original cleanup and a separate final live check establish
stopped, data removed, registry removed and port released, all true. Only the new owned instance was operated.
The fixture's existing evidence writer was redirected to the NEW independent directory; the sealed delivery's
`w5-http-checks/fixture-wiring.json` was hashed before/after and preserved. Installed websockets emitted two
deprecation warnings. No actual local model, paid provider, real corpus or working pair was started.

The owned PG run preceded the report-integrity repair. The repair changes only final evidence validation,
the extra observed receipt hash and manifest selection. Its affected paths were rechecked offline; real
engine/router/auth/HTTP behavior was unchanged and the PG fixture was not repeated.

The Windows tests use an actual directly launched Python process and an independent actual Node process
held by the test parent. Normal `NodeSupervisor.poll/admit/close`, Windows executable/creation identity,
the full runtime source verifier and admission handshake run without substitutes. After admission the
actual public Core client receives one 503 response from a new owned localhost socket; it sends no claim
or apply POST, persists failed HTTP and both source reports, exits, and is reaped using the original handle.
A separate case advances only the handshake clock after actual Popen launch and verifies that the exact
unadmitted Node is terminated and the Python sibling remains live until its own owned cleanup. Ownership
paths are fixture-only; no PostgreSQL is launched by these tests. This is custody/failure proof, not an
end-to-end actual-model HTTP success claim.

Reproduction commands (the owned PG command creates a fresh fixture; do not rerun it merely to read evidence):

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py python
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py node
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py owned-pg
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py affected
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py custody
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-independent-checks/run_checks.py quality
```

The recorded initial `python` run preceded the added PG wrapper and later report cases; rerunning that mode
now selects more tests. The exact executed selectors and results remain in the immutable recorded JSON.

## Source custody

Final runtime manifest: `w5-http-checked-v2-source-manifest.json`, **5084 entries**:

`921a6dc4ac0b3d80f880bca3a2b3679314be3800b3c77ffdbafa9584ab93d415`

Both the existing Python diagnostic entry and Node client now select this manifest. Its union remains exactly
the same predecessor + fixed dependencies + 17 declared additions. Independent tests/reports are separately
sealed evidence; they do not expand the runtime inventory. No new dependency was installed.

- The original delivered manifest remains byte-identical at
  `24d34865c137cecfb2b0b7b92157903104e10827da9971c668685bc07f23ad66`.
- The entire 404-entry predecessor and all its files remain unchanged:
  `ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb`.
- The 4693-path dependency list remains unchanged:
  `15540ca2b6a078fc0e0a4de91c08643900abe7f536e47732186ba60b4863810d`.
- Five of the NEW HTTP delivery entries changed; the other **5079** original entries retain their bytes.
  Exact before/after identities are in `w5-http-independent-checks/checked-source.json`.
- Six original HTTP source/test preimages and the original manifest were copied and byte-verified before
  repairs. Their ledger is `w5-http-independent-checks/delivery-preimages/preimages.json`, SHA256
  `ab1c16e336e9b6d79b7bca167c1d71d0bdc9035f6211372f8cf32761fd8b1830`.
- The earlier checked manifest is retained at
  `b0acdf7702330f2cb8891b36eca7b4f8b7f3d5d93d870e03dab3117d6e6e7c0a` with its own recorded source and
  Windows custody evidence. It was superseded solely to add the transport status check and final manifest selection.

Repository heads remained TakiAgent `fccfc4fb78958c90efebdb4a5a98b355bcb73a40` and Native
`6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. There was no production, historical helper/report/manifest,
leader document, model/configuration or task-pointer modification; no commit/push/archive or delegated agent.

## Parent execution gate

This PASS permits exactly ONE already-approved parent-run fresh actual-model HTTP clone, using the existing
bounded entry (which selects the new checked v2 manifest):

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone
```

Default invocation remains inert. Before treating the actual run as successful, require its complete final
HTTP report, source/report agreement, measured full public method below 60000ms, exact SQL/HTTP lookup proof,
all preservation flags and stopped/port-released cleanup. Initialization retains the continuous 180-second
anchor; overall supervision remains 900 seconds. Cached real reranker readiness must be established by that
run. A late committed receipt, deterministic fixture, direct Native timing or this check never replaces it.

This check does not release or renew the working pair, approve maintenance, convert/re-extract the corpus,
complete W5/manual acceptance, dispatch W6-W8 or authorize Git/lifecycle operations.
