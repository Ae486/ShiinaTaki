# W5 checked native-view actual-model execution

## Result and release boundary

Parent executed the independently checked postpatch entry once on 2026-10-05. Diagnostic correctness,
inventory identity, preservation and owned-process cleanup passed. **Native timing failed:** full apply took
60.5443404 seconds against the unchanged 60-second observation. No HTTP measurement, working-pair migration,
authority recovery, maintenance allowance, admission renewal or W6 dispatch follows this result.

The owner authorized continuation and binding to the existing task. Session
`codex_01a10bce-c98d-7930-a034-2842a2739758` is bound. Taki/main remains
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; Native/main remains
`6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Both worktree lists were inspected.

## Execution identity

Command from `H:/TakiAgent`:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-native-view-postpatch.py --run-reviewed-clone
```

Parent first matched the final checker handoff SHA256 and called
`verify_inventory('e0ec8c9e8b10706411e1f1bc2c43d1d0022a2b010471ef3bc976e4bea8331f4c')`:
382 entries and seven inherited manifests passed. The original delivered manifest remains sealed.

- Job: `.trellis/.runtime/w5-actual-embedding-2e081d2289694da987c48eb7455690a2`.
- Fresh clone: `.trellis/.runtime/w5-candidate-native-clone-0af8fc86c932456e988477b8fda2c2f6`, port 1211.
- Parent PID 14116; held/script worker PID 30268, verified base executable and venv/package origins.
- Transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`; delta operation
  `6497dfc9-e287-4cb1-96b5-1020ea1eabc4`; request SHA256
  `946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.
- Ordinary clone claim used generation 2. No working-pair request was submitted.

## Measurements

| Measurement | Observed value |
| --- | --- |
| Offline model | BAAI/bge-small-en-v1.5, CPU, dimension 384, cached revision 5c38ec7c405ec4b44b94cc5a9bb96e735b38267a |
| Model initialization, outside apply | 19.244834 s |
| Actual document encoding | One batch, 68 inputs, 3.2272093 s |
| Explicit clone e30-to-e40 migration | 3.3663132 s; migration and preservation proof 22.3001404 s |
| Full apply | 60.5443404 s; budget FAIL |
| Independent baseline passes | 16.6093733 / 16.5080334 s |
| Native/application writes | 7.3975082 / 9.8290108 s |
| Exact lookup | 0.9052589 s |
| Apply plus lookup/bookkeeping | 61.4628758 s; not HTTP latency |
| Watchdog | No timeout or forced child termination; child exit 0; 146.156 s supervised elapsed |
| Telemetry | 288 samples, no sampler errors; PostgreSQL-backend attribution absent by design |

At 60.4484326 seconds the diagnostic observer still saw a pending full apply, executing the final delta-receipt
INSERT. The actual full-apply completion is still over 60 seconds. Scheduling delay in this observation and a
successful diagnostic exit do not turn it into a timing pass. The 180-second collection bound is not a production
request-timeout extension. No synthetic encoder or query encoder was used; LLM calls were zero.

## Parent verification

- All four persisted parent/worker before/after reports exactly equal the checked inventory identity. Their
  identical file SHA256 is `e23b13ae58b4a961e91061b8738513d3625d013a4148d191df7a10bbd53b265b`.
- Exact lookup equals the committed result; one delta row, 1559 mappings and 1558 artifacts. The request identity
  remains unchanged. Historical maintenance is preserved.
- Source native data, copied inputs, Core, preserved original sibling and all checked sources are unchanged.
  Original owned source inventory contains 1660 files / 550592708 bytes.
- Child and parent both report stopped and port released. Parent then independently found no listeners on
  1211/18495/18496 and no matching model/clone process. Clone ownership records `stopped=true`; files are retained.
- `diagnosticSucceeded=true`, `nativeApplyBudgetPassed=false`, `httpOrAuthorityRecoveryProven=false` are separate.

Evidence SHA256:

| File, relative to job | SHA256 |
| --- | --- |
| result.json | d8772db72496b14a7bbf2cb238e253898404988e8be986d7a115459c81e5833a |
| telemetry-result.json | 52c30f2966b5d7f69d2e0d8d9ee10468f2ca2c8a2320f794fab4892723fe823a |
| postpatch-result.json | 5b3027ceefe89fb49c7eca0f7a82f95747e5919deca8e087e6ac20a49abc4b04 |
| telemetry.jsonl | 1ed17f74cb12f52879d28364c70a94372f1de84d61a416bb54e24f2c799e3de4 |

The clone's separate result SHA256 is
`f8985f8be18eb14ee41989a9c765de7bee3d89bf14dcc32a0cb337f209889842`.

## Continuation

Independent reviewer `/root/w5_postpatch_review` is read-only auditing the new result and comparing existing
SQL/stage/CPU evidence with prior actual-model and detailed baseline profiles. It must establish whether expected
duplicate work disappeared and propose a measured narrow residual diagnosis/repair. No broad benchmark rerun,
production change or HTTP harness is authorized by this failed performance result alone. Parent must review the
next concrete scope before implementation. W5 remains incomplete; W6-W8 and manual acceptance remain gated.
