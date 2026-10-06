# W5 Actual Local Embedding Diagnostic Implementation

Status: NEW parent-only helper delivered; fake/harness checks PASS. No actual model, corpus clone, PostgreSQL,
working-pair migration, authority recovery, maintenance, or LLM was executed by this implementation agent.
The parent must review this delivery and its new source manifest before invoking the explicit execution flag.

## Scope and files

The approved design is `w5-candidate-actual-embedding-discriminator-design.md`, SHA256
`bcd0ac96142cf27f5c345b6d6f5e0e27091352fa4933d03363a7b16e32b61f6e`.

- `w5-candidate-actual-embedding.py`: parent supervisor, durable job custody, hidden child entry, parent failure
  report, and independent post-child preservation checks.
- `w5_actual_embedding_control.py`: clean environment, atomic JSON, immutable source verification, Windows
  executable/creation-time identity, exact child-handle watchdog, and guarded owned PostgreSQL cleanup.
- `w5_actual_embedding_composition.py`: thin loader composition over the two frozen helpers, actual embedding
  initialization/instrumentation, preparation injection, and NEW result-label adaptation.
- `test_w5_actual_embedding.py`: fake-only semantic, process, ownership, failure, and serialization regressions.
- `w5-actual-embedding-final-checks/`: final command lines, exit codes, and raw output. The earlier
  `w5-actual-embedding-checks/` records the intermediate 18-test pass and remains unchanged.
- This report and `w5-candidate-actual-embedding-source-manifest.json`: usage and new immutable inventory.

No production, previous helper, previous report/manifest, task pointer/lifecycle, dependency, or runtime log was
modified. No Git write operation was performed. The original cumulative independent inventory's 233 non-runtime
files were rehashed and remain identical. Its 14 runtime entries, plus its already excluded historical runtime
references, are carried as references without reopening old runtime artifacts or corpus data.

## Composition and semantic boundary

The frozen migration rehearsal still performs its explicit e30-to-e40 upgrade, complete pre/post catalog/data
proof, and then calls the frozen clone's original apply path. The new loader wraps that callback so model
initialization happens after migration proof and before original `run_clone` setup and timed apply. Consequently
the result is SQL-prewarmed, just like the parent-reported c79 comparator.

Exactly one normal `LocalSTEmbeddings` uses `model_name="BAAI/bge-small-en-v1.5"`, `force_cpu=False`,
`trust_remote_code=False`, and `allow_mps=False`. It is initialized independently of any full MemoryEngine,
reranker, or LLM. The sole semantic injection replaces `embeddings_model` at
`transition_delta.prepare_current_state_rows` and calls the original production function with the original
request and formatter. The real observation/date/entity/mental-model augmentation and
`embedding_processing -> embedding_utils -> encode_documents` path remains intact, including its worker thread.

The actual instance's document encoder is transparently timed and counted; query encoding refuses. The original
synthetic instance's dimension, obtained by the frozen helper from copied SQL, must match before preparation and
delta writes. Its document/query methods become refusal sentinels, and the report asserts no synthetic call.
Normal claim, original request hash, renewal, timed apply, exact lookup, delta count, and preservation remain in
the frozen implementation. A transparent wrapper on that one diagnostic service's lookup supplies a separate
`exactLookupMilliseconds`; `applyElapsedMs` continues to include lookup/bookkeeping and is not relabeled full apply.

The frozen rehearsal sends final JSON directly to its V3 serializer, bypassing `clone.write_json`. The new loader
therefore wraps that exact serializer too. All NEW successful/failed result files remove misleading synthetic
vector/call labels, record actual model counters and the new manifest hash, and separate apply completion from
`nativeApplyBudgetPassed`. Historical JSON is never rewritten. Native timing is not HTTP/authority proof.

## Environment and process control

Only the reviewed Windows/toolchain allowlist is inherited. Dotenv/uv env loading and HF/Transformers networking
are disabled; tokenizer parallelism is false. Provider/PG/API-key and arbitrary cache/device overrides are dropped.
The supplied defaults retain actual automatic device selection and normal model cache location. Missing cache
is an offline failure; there is no download or alternate-model path. The frozen loopback-only socket guard and
nonexistent libpq password/service paths remain active before initialization.

Installed `huggingface_hub.utils._headers.get_token_to_send` reads the cached token before checking its implicit
token switch. The NEW environment therefore both disables implicit tokens and sets `HF_TOKEN_PATH` to an asserted
nonexistent directory inside the new job. `HF_HOME`/`HF_HUB_CACHE` are not redirected. No private token was read.

Parent job custody is fsynced before child launch. The child waits for its exact executable/PID/creation-time
receipt, tied to the owning parent. Clone/data/port/expected PostgreSQL executable custody is fsynced before
`pg_ctl start` can run. The child process is hidden; its stdout/stderr are discarded to avoid raw library error
text. Structured failures contain closed error classes, counts, hashes, and timings, without source texts/vectors.

The external parent uses a monotonic clock and its held Popen handle, not an asyncio cancellation or PID search:

| Boundary | Limit | Meaning |
| --- | ---: | --- |
| Model initialization, including import | 180 seconds | Hard child termination while synchronous loading blocks |
| Entire diagnostic child | 900 seconds | Covers copy/migration/proof/model/apply/shutdown work |
| Frozen apply collection | 180 seconds | Existing diagnostic collection ceiling, unchanged |
| Frozen apply observation | 60 seconds | Existing request-budget discriminator, unchanged |
| Post-termination PG startup settling | At most 45 seconds | Lets an already launched frozen `pg_ctl start` reach its finite timeout |
| Parent owned-PG stop attempts | At most 70 seconds | Fast, then immediate; each command has a 35-second process bound |

Child termination is awaited for at most 10 seconds. Cleanup and parent source rehashing follow the diagnostic
deadline; they do not extend model execution or production timers. A timeout fact is fsynced before termination,
so termination/wait failure cannot erase it. A child that remains live causes cleanup refusal rather than racing
its future startup. PG stop requires canonical owned data path, matching PID-file port, expected executable,
creation time consistent with the PID file, and (once recorded) exact process identity. A bad pointer, foreign
process, or failed stop produces false/unknown cleanup facts and retains all evidence. No port-to-PID guessing,
process-tree kill, original sibling startup, or failed-evidence deletion is used.

The parent writes its result even if the child produced no JSON. It repeats source/input/Core/original/source-code
preservation independently; this does not manufacture a missing Native apply/migration receipt. The watchdog must
remain running. Manual termination of the watchdog itself is outside the automated deadline contract; the durable
job/clone pointer remains the recovery evidence.

## Final verification

The commands and raw output are in `w5-actual-embedding-final-checks/result.json` and adjacent logs:

- 20 tests PASS in 4.846 seconds. Fake model only; real production preparation/augmentation/worker-thread encoding
  uses that fake. A separate real hidden Windows Python sleeper proves exact handle identification and hard
  termination without any ML/database/corpus work.
- Ruff and Ruff format PASS on the four new Python files using Native `pyproject.toml`.
- Scoped ty PASS on those four files using the existing Native environment and explicit research module path.
- AST syntax PASS on all four files; no-argument entry PASS with `executed=false` and no data/model access.
- 233 cumulative non-runtime source/evidence entries remain byte-identical; 14 runtime entries were not reread.

Regressions cover normal augmentation and model options, observation/mental-model text, transparent document
vectors/counters, query/synthetic refusal, dimension mismatch before preparation, offline failure without fallback,
HF credential redirection without cache relocation, exact date-formatter equivalence across all months, the
rehearsal's direct V3 result sink, separate apply/lookup budget labels, both monotonic deadlines, timeout persistence
before termination failure, parent watchdog failure, PG PID/path/port/image/creation guards, pre-start pointer
ordering, refusal without pg_ctl, failed-stop evidence, and parent fallback with no child report/malformed custody.

The existing production seven-file ty result is unchanged: the independent report retains its one baseline
`transition_delta.py:97` optional-UUID diagnostic. This delivery's scoped type pass does not relabel that baseline.
The source files were not modified and their broad correctness suite was not redundantly rerun.

## Parent usage

1. Review this helper, tests, source inventory, and the final manifest SHA256 delivered by the implementer.
2. Keep the working pair stopped. From `H:/TakiAgent`, run once:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-actual-embedding.py --run-reviewed-clone
```

3. Follow the printed `W5_ACTUAL_EMBEDDING_JOB` path. The NEW job's `result.json` contains parent watchdog,
   independent preservation, cleanup, and the child's actual-model result. Phase and embedding progress are
   separately durable. The fresh clone remains retained. Exit 1 means diagnostic failure; a completed late apply
   can exit 0 while its separate `nativeApplyBudgetPassed` remains false, so inspect both facts.
4. Compare `fullApplyMilliseconds`, `exactLookupMilliseconds`, initialization time/device/dimension, document
   counts, the unchanged 60-second observation, and receipt/migration/preservation/cleanup evidence. Do not infer
   acceptable HTTP overhead or actual authority recovery from direct Native completion.

The parent-reported c79 full apply was 56.018 seconds, with 68 document inputs, 68 invalidation INSERTs, and zero
memory_links INSERTs. It did not prove live semantic graph creation. Actual encoding and temporary vector-index
insertion costs remain unmeasured until the parent executes this helper. Working-pair migration, exact interrupted
recovery, complete roundtrip, maintenance readiness, and owner/manual acceptance retain their separate gates.
