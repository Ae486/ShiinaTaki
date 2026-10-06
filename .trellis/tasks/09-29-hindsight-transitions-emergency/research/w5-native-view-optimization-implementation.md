# W5 locked-baseline native view optimization

Date: 2026-10-05. Implementer: `w5_native_view_resume`.

## Delivery and boundary

The approved two-file Native patch and NEW postpatch actual-model/telemetry composition are implemented.
Scoped fixture correctness and static checks pass. Independent review, actual-model timing, HTTP timing and
the real working-pair recovery remain separate gates. No real corpus clone, model, HTTP service, working-pair
database, authority recovery, maintenance allowance, renewal, commit, push or archive was executed here.

Verified checkouts: Taki `H:/TakiAgent`, main, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`;
Native `H:/hindsight`, main, `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Both worktree inventories were read.
The child session's `task.py current --source` returned none; the parent explicitly assigned the existing
`09-29-hindsight-transitions-emergency` task and instructed this child not to alter the global/session pointer.

All six earlier `w5-native-view-preimages/manifest.json` entries were verified against their stored preimage
and the then-current file. They were identical: no production patch had been applied before interruption.
The existing partial `test_transition_native_view.py` contained seven failing regression cases targeting the
not-yet-implemented `_locked_source` argument. Those cases were retained and extended. A NEW
`w5-native-view-resume-preimages/manifest.json` preserves the six files and the partial test before this work.
Existing unrelated WIP, old helpers, manifests and results remain unchanged.

## Owned changes

Native paths below are relative to `H:/hindsight/hindsight-api-slim`.

| File | Responsibility | Final SHA256 |
| --- | --- | --- |
| `hindsight_api/engine/transition_snapshot.py` | Supply only an opt-in baseline's freshly loaded source | `eb5d447224ac67357265af860d60d20024c75e8b12cc30deecab9ad94994cbda` |
| `hindsight_api/engine/application_state/snapshot.py` | Private locked source/head index and equivalent current-native validation | `986ab9fab3e643ee5207c9df3cc4fe9c5b02d035223a8af2a9b0f585374e33a1` |
| `tests/native_results/test_transition_native_view.py` | Canonical hashes, body/head/inventory refusal, duplicate-key fallback, Unicode/entity order and normal fresh reads | `c4d852639f44f470dafa77447be0fdd712f826478af9bcf626a9a23555eb735b` |
| `tests/native_results/test_transition_native_view_pg.py` | Actual SQL differential coverage, all kinds, archive duplicate IDs and document evidence | `8f098cc585a8cdc0fb6c9058e8a873284f46a80cdf4fbf5e44ddad064ab7dfb2` |
| `tests/native_results/test_transition_baseline_reads.py` | Independent native sources, locked differential and three second-admission corruption classes | `d6e561b2118c11ff1171fe645d21ae5075b567e86629dc46b07ae6a1aba0f2d8` |

Only the relevant paragraphs of Taki `memory-transitions.md`, `memory-transition-healthy-drivers.md` and Native
`TAKI_PATCHES.md` were updated. NEW task-only files are `w5_native_view_inventory.py`,
`w5-native-view-postpatch.py`, `test_w5_native_view_postpatch.py`, this report, the postpatch source manifest,
the resume preimages and `w5-native-view-checks/` evidence. No script template or platform registry changed.
The exact complete inventory is `w5-native-view-postpatch-source-manifest.json`; its externally reported SHA
avoids a report/manifest self-hash cycle. The independent checker brief is parent-owned and excluded.

## Preserved production contracts

- The real `_admit` path still acquires `lock_transition_bank` and validates the live executor, request and
  retired proof inside ordinary `conn.transaction()`. The two admission transactions remain independent.
  This is a write-free locked validation segment, not a general transaction cache or readonly-RR claim.
- The bundler reads heads with their actual SQL object keys, using the same parser, scope and ordering as
  `store.heads`. A malformed envelope under a different SQL key cannot impersonate the omitted point lookup.
  Missing/extra key sets retain capture-gap refusal. Duplicate native/head keys and mismatched SQL/envelope
  keys use the ordinary point path without collapsing ambiguity into a selected cached entry.
- Valid-row payloads come from the unchanged bulk serializers. Every reused payload still gets the canonical
  native hash check. Python model equality is not used as that proof: nested `True` and `1` remain distinct.
  The freshly parsed exact head, immutable body's exact version/hash and Bank are independently checked.
- Invalidated memories always retain `current_native`. Their bulk Python entity order and repeated IDs differ
  from SQL collation and `ANY` deduplication; no serializer, archive reader or lifecycle rule changed.
- Document original text, retain parameters, availability and full Source digest comparisons remain fresh point
  reads. All immutable body accesses still decode, validate schema and revisit Source/reference closure through
  the existing reader. Codec, store, reader, migrations, deadlines, model settings and all other production
  files are outside this patch. Borrowed indexes stay inside the private bundler and do not survive its return.
- Normal snapshots/hydration still load their own source/point reads. The existing reader's disposal,
  cancellation, rollback, predecessor and final post-write view semantics remain unchanged.

## Actual checks and reruns

Every PostgreSQL invocation used the existing isolated runner, fresh owned PG18.1 fixture, deterministic model
fixtures and its egress guard. All five fixtures below stopped successfully; owned data and registry entries
were removed and their logs retained. No original/real-pair database was opened.

| Invocation / fixture suffix | Selected tests | Outcome |
| --- | --- | --- |
| Prepatch RED `b0c6cabc4de3` | Existing partial native-view tests | 7 expected failures: missing `_locked_source`; 2.17s |
| First postpatch `552bbbbbcab6` | Native-view, baseline-reader, artifact-reader, transition-delta files | 73 passed; 447.19s |
| Added coverage `0fbe11f658a3` | Native-view, new PG differential, independent-source baseline case | 24 passed, 1 test-assertion failure; 71.31s |
| Corrected/refusal/ordinary `423ca14bac0f` | Three document-evidence cases, three second-admission cases, application-state file, ordinary concurrent RR snapshot | 12 passed; 59.63s |
| Final locked differential `5ca62291f1de` | New PG differential file and existing ordinary/optimized complete-baseline case, now explicitly using `lock_transition_bank` | 6 passed; 72.27s |

The one added-test assertion incorrectly expected `capture_gap/503` for a retain-parameter change. Retain parameters
also alter the logical document payload, so both ordinary and optimized paths correctly reject earlier with
`native_version_conflict/412`. The test expectation was corrected; production code was unchanged by that finding.
Original-text and availability changes still reach the independent Source check and refuse `capture_gap/503`.

The final covered set has **89 distinct cases**, exercised across the rounds above, not a single 89-test rerun:
native-view 19; baseline reader 32; artifact reader 11; transition delta 16; new PG differential 5; ordinary
application state 5; ordinary concurrent RR snapshot 1. Repeated executions in the table are not additional
unique tests. The original unparameterized second-admission case was extended to body/native-payload/document-
original variants. The explicit-lock rerun is necessary because the optimization's precondition includes the
actual production Bank/fence lock, not merely a fixture with no competing test writer.

The complete differential compares the entire `TransitionBaseline`, including all component/full hashes and
auxiliary rows. It checks one source load instead of two, only archived-memory point fallbacks, all five Native
kinds, non-ASCII entities, duplicate archive entity IDs, observation source references and preserved original
Source/memory-policy/Block bytes. Same-name entity ordering is isolated in the pure serializer test because the
actual SQL schema enforces unique lowercased names per Bank. No unique index was weakened for a fixture.

Fixture logs: `.trellis/.runtime/g1-validation/taki-hindsight-g1-<suffix>/pytest.log` and `ownership.json`.
Commands used the same prefix from `H:/TakiAgent`:

```powershell
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- <selectors-above> -q --tb=short -n 0
```

`w5-native-view-checks/quality-final.json` records exact static/test argv, cwd and outputs. Native scoped Ruff
and format on the two production and three test files pass; helper Ruff/format and helper ty pass; nine offline
verifier/composition unittest cases pass. Default NEW helper entry prints `executed=false` and neither verifies
inventory nor starts work. `git diff --check` passes for the scoped paths; Git emits the existing Native Markdown
LF-to-CRLF checkout warning. An initial new-test import-order lint failure and two new helper function-assignment
ty diagnostics were corrected; `quality.json` retains the earlier result.

Exact production type command, from Native `hindsight-api-slim`:

```powershell
& H:/hindsight/.venv/Scripts/ty.exe check hindsight_api/engine/transition_snapshot.py hindsight_api/engine/application_state/snapshot.py --output-format concise
```

That two-file check passes. A separately executed default three-file check adding `transfer/transition_delta.py`
also passed in this environment. This is **not** the historical seven-file command/preimage comparison and does
not erase its documented Optional-UUID diagnostic or certify the whole package. No whole-package type/lint suite
or old broad PG group was repeated. The parent-approved scoped commands replace the unrelated global `lint.sh`
auto-fix/dependency-sync hook. `trellis-before-dev`, scoped `trellis-check` and the Native code-review standards
were applied without spawning another agent.

## NEW complete-inventory composition

`w5_native_view_inventory.py` pins the bytes of seven inherited manifests (telemetry, baseline profile, V2,
V1, combined, trigger repair, reader repair), then checks every inherited entry. Only the six explicitly owned
existing files (two production files, baseline tests, two Taki specs and Native patch ledger) can receive new
hashes. Every other inherited entry must retain its exact size/hash; omitted, duplicate, extra, wrong-manifest,
undeclared addition and non-allowlisted replacement fail closed. Each inherited manifest itself also appears
in the complete final inventory. The final inventory includes all explicitly declared new sources/preimages.

The NEW entry composes the unchanged V2 actual-executable launcher, model/clone/migration/cleanup/watchdog and
telemetry. It directs V2's actual worker to the NEW script, restores the new manifest after V2's historical
runner assignment, and directs nested rehearsal/V3 original source validators to the new complete inventory.
Original fixed helper/dependency hash checks remain active. No old helper or manifest is edited or broadly
disabled. The inherited manifest byte pins are checked before the adapted entries can be used.

Parent and actual worker independently verify the same inventory SHA/count before and after execution and
write `inventory-parent-before.json`, `inventory-parent-after.json`, `inventory-worker-before.json` and
`inventory-worker-after.json`. Worker admission compares the parent's persisted `job.json` manifest SHA.
`postpatch-result.json` requires all four exact reports plus the inherited telemetry diagnostic success;
missing worker proof cannot become success. The original result and separate telemetry result remain intact.
`nativeApplyBudgetPassed` remains independent from diagnostic completion, and HTTP/authority acceptance stays false.
Runtime monkeypatches are restored even on errors; the nine offline tests cover these routes and refusals.

## Parent-only remaining execution

1. Independently review these changed sources, tests, preimages, verifier and exact manifest. Rehash the manifest
   itself against the implementation handoff, then run `verify_inventory(expected_sha)` from the research folder.
   Running an old sealed verifier must continue to fail on the authorized changed source.
2. Only after independent approval, the parent may execute one NEW fresh clone with the actual offline local
   embedding model and worker/system telemetry, from Taki:

   ```powershell
   & H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-native-view-postpatch.py --run-reviewed-clone
   ```

   Default invocation performs no work. There is no accepted existing DSN/clone/job argument for parent execution.
   The hidden worker argument requires the existing owned-job/process handshake. Initialization180s/overall900s
   diagnostic watchdogs, Native60s observation, migration/SQL/stop bounds and all original preservation checks
   are unchanged. Do not infer HTTP latency from direct Native full-apply timing or use model-free timing as the
   actual-model gate. The implementation makes no numerical saving or request-margin promise.
3. Inspect all inventory reports, original `result.json`, `telemetry-result.json`, `postpatch-result.json`, exact
   delta/lookup/mapping/artifact proof and owned-clone stopped/port-released evidence. Only adequate fresh actual-
   model margin can lead to a separately reviewed complete HTTP measurement.
4. Real-pair migration/recovery, the same admitted transition, per-Bank actual maintenance plans/allowances,
   complete roundtrip/custody/readiness/queue proof and final independent W5 review remain parent-owned gates.
   No additional renewal, inferred manual acceptance or W6 dispatch follows this patch delivery.

No production scope conflict or unresolved fixture correctness defect remains in this implementation. The
independent checker may still find issues; performance and real journey acceptance remain unperformed here.
