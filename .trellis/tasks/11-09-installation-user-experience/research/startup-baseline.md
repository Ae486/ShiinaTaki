# Startup and local request baseline

Date: 2026-11-09. Development is authorized; these are pre-runtime-change observations,
not final acceptance. Source preimages and SHA-256 manifest are retained under
`artifacts/configuration-runtime-20261109/baseline/` (2,597 files, 15,133,514 bytes).

## Actual process probe

Command from the T4 root:

```powershell
node artifacts/configuration-runtime-20261109/run-baseline.mjs before
```

Node 24.18.0, Windows, existing production Core imported directly with a test-only
IPC sampler/stop control. Every run used a new synthetic profile, isolated port,
hermetic TAKI environment and the existing local scripted compatible provider.
No `.env.local`, ordinary profile, credential account or remote provider was used.

Evidence: `artifacts/configuration-runtime-20261109/before/baseline.json`.

| Scenario | Observed result |
| --- | --- |
| Empty Main/Utility | Core exited 1 before listening; required Main URL/key/model validation appeared. |
| Compatible endpoint/model without API key | Core exited 1 before listening; API-key validation appeared. |
| Complete compatible profile, three fresh runs | WS available in 3,320 / 3,326 / 3,420 ms; startup made zero provider calls. |
| config.list, 20 sequential calls per configured run | Most 2.5-4.5 ms; one 30.7-ms outlier, retained in raw evidence. |
| Configured idle, two seconds per run | Process CPU 0 / 0 / 16 ms; RSS 313-315 MB. Short samples, not a long-idle guarantee. |
| First local chat | ACK 46-57 ms, complete 330-335 ms, actual production SDK-to-local-HTTP path. |
| Cleanup | All five owned processes exited; no real provider calls. |

Repeat the same fixture for comparable configured-path results after changes.
Treat startup, local request overhead, and resource retention separately; do not
hide a regression behind reduced provider latency. Baselines are provisional
observations with small samples, not invented absolute performance promises.
Native Home/Pet usability, native memory/CPU and reconnect/update behavior require
their own later process/UI observations; this probe does not establish them.

## Startup trace implications

- The scheduled provider currently awaits due dispatch before the WS listener opens.
  Recovery classification must remain before dispatch, while basic service availability
  must not wait for a model-dependent scheduled operation.
- Capturing only a model is insufficient: replay budget, calibration callbacks,
  request-window snapshots and usage attribution also belong to the admitted Run.
- Ordinary application-first scalar configuration is an independent change. Reset
  validation must use the actual environment/default fallback, because removing the
  old environment lock makes that path reachable.
- The native helper can be reused but should not be spawned for each request;
  cache bootstrap material within its existing process ownership. See the separate
  Desktop startup map for actual build/read evidence.

The final split is based on these boundaries and the two startup maps. Existing
Run/Memory/queue authority stays intact; no complete secondary Core is introduced.
