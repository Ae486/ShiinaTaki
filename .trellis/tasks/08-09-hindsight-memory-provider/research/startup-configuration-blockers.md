# Startup configuration blockers observed during E2E

Updated 2026-11-12. Owner requirement: record settings that currently prevent startup, so a later task can make
them configurable after startup. This ledger records product deficiencies and test-environment failures separately.
It does not claim that copying caches or repairing the harness implements deferred configuration.

## Required product behavior for the follow-up

Taki's basic plane and configuration UI must remain reachable with optional model/feature settings absent or invalid.
Show the affected feature as explicitly unconfigured/unavailable with a useful reason. After the user supplies valid
configuration, allow supported preparation/retry and establish readiness from the real producer. Do not fabricate
success, silently change memory authority, lose accepted writes, or reopen original data with incompatible code.

The owner specifically includes Hindsight embedding and reranking models. The exact Native lazy-initialization,
Host-management or service-restart design remains for the later Hindsight task; this record does not choose it.
Taki boot and Native Hindsight boot are different gates and must be measured separately.

## Observed Native model-preparation blockers

| ID | Missing prerequisite and affected stage | Reproduction and evidence | Temporary E2E preparation | Required later acceptance / current status |
| --- | --- | --- | --- | --- |
| HS-START-01 | Embedding model/cache: `BAAI/bge-small-en-v1.5`; Native initializes the local embedding provider during API startup | Fresh isolated G profile, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, neither model cache present. `G:/taki-first-use-2WoLNy/native.log` lines 39-41 and 189-190 show both providers starting, missing model/cache and application startup failure. Raw result: `2026-11-12T07-32-09.111Z/result.json`; Native exit 3, zero business steps. | `prepare-native-cache.py` copies the existing cache into a new isolated profile, verifies file hashes and source unchanged, and downloads nothing. | Open. Application/settings must be usable before embedding configuration; model preparation failure must remain recoverable. This run omitted both caches together, so it is not an independently isolated embedding-only failure test. |
| HS-START-02 | Reranking model/cache: `cross-encoder/ms-marco-MiniLM-L-6-v2`; Native initializes `CrossEncoder` during API startup | Same run; `native.log` lines 40 and 185-189 contain the reranker initialization, missing offline Hugging Face files and `Application startup failed. Exiting.` The API does not reach healthy startup. | Copy and hash-verify the existing reranker cache into the isolated profile. The next run boots Native in 45,444 ms. | Open. Configuration UI must remain accessible before reranker setup; validate failure and later readiness separately from embeddings. Successful cached boot is not a deferred-configuration fix. |

Both model identifiers were configured in this run; the missing prerequisites were their files in the isolated
offline cache. This is evidence of eager Native model preparation failing, not a separate test with model settings
omitted. The reranker exception directly aborts startup; embedding initialization also reports its absent model,
but the two failures were not isolated from each other. A model identifier alone does not supply weights/config files.
No network download was authorized or required by these controlled E2E attempts.

The harness waits for Native health before starting Core/Home, so the first failure produces zero business steps.
It does not independently prove that an already running Taki basic plane or the shipped management UI becomes
unreachable. Later acceptance must exercise the actual management path with each model absent/invalid separately,
keep settings reachable, then verify supported preparation/retry. The product requirement remains open.
Core's independent no-model smoke already passed, including typed model-unavailable admission and zero Runs;
that evidence does not prove that the Native service or its full management journey supports missing models.
The later [configuration-to-chat check](../../11-11-main-t4-baseline-integration/research/configuration-recovery-chat-20261112.md)
also passes: in the same Core process and connection, configuring a keyless loopback Main model enables the next
actual streaming chat, with one completed Run/Attempt and exact persisted text. Native Hindsight is absent from
that test. The two Native model-preparation requirements above remain open.

The final configured connected journey (`2026-11-12T10-14-33.205Z/result.json`) passes all 24 stages, including
Home configuration, repeated restarts, offline takeover and authenticated paired restore. Both model caches were
prepared before startup; this result does not close HS-START-01 or HS-START-02. The later task must test each
absent/invalid model separately, preserve access to application settings, configure after startup and verify
real producer readiness and retry without losing accepted writes. See the
[configured journey receipt](../../11-11-main-t4-baseline-integration/research/connected-journey-acceptance-20261112.md).

## Test-environment blockers (do not classify as required product settings)

| ID | Observation | Evidence / handling | Status |
| --- | --- | --- | --- |
| E2E-ENV-01 | Isolated `USERPROFILE` removes the Python user-site path containing Playwright. Native/Core boot passes, then Home onboarding raises `ModuleNotFoundError: No module named 'playwright'`. | `2026-11-12T07-51-08.211Z/result.json`, `G:/taki-first-use-qTPkID/home-onboard-*/result.txt`, integration `journey-20261112.log`. Browser-only `PYTHONPATH` uses the installed dependency with user-site disabled; actual Python/Chromium preflight now runs before Native. Real profile and credentials stay isolated. | Fixed in the harness. Python 3.12.7 / Playwright 1.54.0 / Chromium 139.0.7258.5 preflight and final 24-stage connected journey pass. |
| E2E-ENV-02 | The controlled full-stack launcher initially required 6 GiB available physical RAM. The continuation initially observed approximately 3.7 GiB and no leftover owned stack; the 10:05 UTC attempt was refused at 5.85 GiB before Native/PG launch. | `run-controlled-journey.ps1` preflight; `Win32_OperatingSystem.FreePhysicalMemory`; timestamped launch receipts. These are observations and a test budget, not a universal product minimum. | After independent review, the threshold became 5.5 GiB. Final configured journey passed from 5.60 GiB launch headroom; 273 samples spanning the later complete journey observed a minimum of 2.072 GiB available RAM. No business assertion or timeout changed. Process working-set sums include shared pages and cannot define a universal product minimum. |

## Recording contract for subsequent runs

For every newly observed startup refusal record: exact absent/invalid input, component and startup stage, scenario,
safe error excerpt, source identity, run/artifact path, whether the basic plane and settings remained reachable,
temporary test preparation, desired recovery behavior and unresolved verification. Mark unexecuted or failed checks
as such. A successful configured run must not close an unconfigured-startup requirement.

Journey `result.json` paths above are relative to
`../../08-09-memory-operations-ui/research/first-use-runtime/results/`; the retained Native log belongs to that
run's `ownedRoot`. Preparation and launcher scripts are under
`../../11-11-main-t4-baseline-integration/research/`. Cache copying is owned by `prepare-native-cache.py`;
it is a controlled-test prerequisite, not Native source or product configuration implementation.

Use [the integration change handoff](main-t4-integration-20261112.md) for code-change ownership and validation.
Do not duplicate these open statuses in a competing checklist; link here from the integration and Hindsight tasks.
