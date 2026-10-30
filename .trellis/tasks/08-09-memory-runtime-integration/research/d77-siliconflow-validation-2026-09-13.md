# D77/B6 SiliconFlow and Reflect Validation

## Scope and current state

The owner supplied and authorized SiliconFlow embedding/reranking access and asked for a longer Reflect wait,
prioritizing completed results. Work continues the existing B6 task on `H:/TakiAgent`, `main`; the native companion is
`H:/hindsight`, `main`. The execution plan is [recorded separately](d77-siliconflow-execution-2026-09-13.md).

The direct API comparison and first full runtime attempt are complete. Recall succeeded, but both initial Reflect cases
reached five minutes. A controlled native attempt now produced a grounded answer in 62.477 seconds after limiting the
existing tool-loop work and providing enough completion tokens for reasoning and final text. Independent review found
remaining default Recall lifetime/cold-cancellation issues. Their corrections and independent review passed. The final
default-budget retest passed six of seven cases, but completed hidden-content Reflect exposed a derived-observation
admission defect. The owner subsequently deferred the broader capability as D81 and prioritized existing B6/B7 work;
see [the sequencing decision](memory-capability-followups-2026-09-13.md). The owner-approved
[bounded B6 closeout](b6-closeout-validation-2026-09-13.md) subsequently removed the blanket experiment and verified
ordinary observations, final source and actual curator continuation. Subjective owner approval remains open and D81
still fails propagated visibility; the historical failed attempt below is not reclassified as passed.

Private evidence is under `.trellis/.runtime/d77-api-acceptance/ca744d0f8a27`. The source is the cleanly stopped previous
acceptance target `9e41c8d27fa0`. Its SQLite database and PostgreSQL data were copied to a new protected directory;
1,612 source files and the original user database files matched before and after preparation. Credentials are protected
with Windows DPAPI and enter only the authorized process environment or request header.

## API availability and controlled comparison

The current official [embedding](https://docs.siliconflow.cn/docs/api/embeddings-post) and
[reranking](https://docs.siliconflow.cn/docs/api/rerank-post) contracts were checked. Both rerankers returned all expected
indices and finite scores; `Qwen/Qwen3-Embedding-8B` returned three finite, 4,096-dimensional vectors with the requested
model identity. Its response reported 26 total tokens. Rerank responses reported token metadata but no model identity;
the requested model is recorded separately from that absent response field.

The comparison uses the same historical 282 Character candidates and 227 Global candidates. Native
`CrossEncoderReranker.rerank` formats the query/document pairs using the preserved text, context and occurrence date.
Candidate text/context matches the saved trace. Both models receive identical input hashes per scope. The original
recency, temporal and proof-count multipliers are retained separately from the new model scores.

| Scope | Reranker | Raw relevance rank | Combined rank | Rerank API seconds | Reported input tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| Character | Qwen3-Reranker-8B | 2 | 2 | 8.797 | 37,850 |
| Character | Qwen3-Reranker-4B | 2 | 2 | 5.750 | 37,850 |
| Global | Qwen3-Reranker-8B | 1 | 2 | 6.078 | 29,631 |
| Global | Qwen3-Reranker-4B | 1 | 2 | 3.579 | 29,631 |

The prior local English reranker put these targets at combined ranks 167 and 158. Its scores exceeded 0.99 for
280/282 and 203/227 candidates; Qwen 8B did so for two candidates in each case, and Qwen 4B for three and two.
The fixed secondary scoring still moves the Global target from raw rank 1 to combined rank 2, but it no longer overwhelms
the retrieval result. Source SQLite bytes remained unchanged throughout the comparison.

Use 4B for this continuation because it achieves the same target ranks with lower measured latency in this small sample.
These four calls do not establish broad model superiority or representative latency percentiles. Ordinary Chinese
questions and subjective answer quality require separate assessment.

The existing native embedding model/index remains in place during the full reranker comparison. The embedding probe is
endpoint validation, not an index migration: new 4,096-dimensional vectors must not be mixed with the existing 384-dimensional
index. A later embedding comparison needs a complete isolated vector rebuild.

## Runtime changes and checks

- Automatic recall has no default business deadline. Explicit finite caller budgets remain available, with unchanged
  shared result/token limits, cancellation, partial Bank behavior, authority checks and ephemeral projection.
- Reflect receives a dedicated five-minute operation allowance through the existing shrinking deadline, preserving
  cancellation, policy admission and scope checks. Foreground Recall/Run capture have no implicit operation deadline;
  individual HTTP requests stay finite, and writes/recovery/scheduled work retain their bounded operation modes.
- The task-only launcher reuses the existing owned-process supervisor and exact PostgreSQL ownership checks. Only the
  approved SiliconFlow host is added to this process's model egress, and actual usage comes from observed responses.
- The automatic-recall regression reproduced three failures before the change; its 24 focused cases and 86 related
  integration cases pass. The subsequent foreground correction preserves bounded modes and handles caller/runtime
  cancellation, same-lease renewal, hydration, queued waiters and cold capability admission.

## First complete runtime attempt

`api-models-1` used the production SiliconFlow adapter, original local embeddings, real copied PostgreSQL/SQLite state
and the actual Taki provider. Both original targets returned at rank 2 (Character 24.924 s, Global 25.094 s).
Two ordinary Chinese questions each returned 25 eligible hits (25.311 s and 13.751 s); their answer relevance remains
ungraded. Automatic recall returned 1,353 characters after 16.662 s and did not append Timeline rows.

The grounded and hidden-memory Reflect scenarios both timed out at approximately 300 s. Actual DeepSeek responses and
SiliconFlow calls succeeded during those operations; the owner also confirmed usage at DeepSeek. This proves model
access, not completion of the full reasoning loop. See [the diagnosis record](d77-reflect-diagnosis-2026-09-13.md).

The supervisor ended with the failed consumer status, all five service groups stopped, no forced process termination
and zero remaining Job members. The complete first attempt is preserved in `attempt-api-models-1` (46 files plus a hash
manifest). New consumer artifacts now include the consumer identity and are written exclusively, so a retry cannot
overwrite those results.

Independent review correctly identified that the first attempt's explicit 120,000 ms request setting masked a remaining
default: the nominal per-REST 10,000 ms setting was also consumed across the whole Recall/sync/hydration chain and cold
Run admission. [The correction contract](d77-foreground-recall-lifetime-2026-09-13.md) separates foreground lifetime from
finite HTTP fault deadlines using fenced lease renewal and caller cancellation. The next real consumer uses 10,000 ms
ordinary requests, no extra generous pre-synchronization, and records individual HTTP durations. Explicit caller Run
deadlines and all existing bounded write/recovery/scheduled paths remain protected.

## Final automated gate and independent review

After the final cold-cancellation fix, the full Core suite passed 3,005 tests in 372 files. All five workspace
typechecks, root ESLint and the task consumer's strict standalone TypeScript compilation passed. Seven new/updated
Python helper files passed Ruff and its format check. A helper's formatting mismatch was corrected before this gate.

Independent review reproduced both last cancellation defects before repair. Its Node-only fixtures then verified that
failed Bank pre-synchronization without capability evidence makes only the two expected health requests, returns the
actual availability error and writes no admission row; cancellation after capability capture also refuses the Run.
The worker's final focused group passed 36 tests in three files. No blocking review finding remains. The review also
checked the canonical tool's unchanged schema, the seven real scenarios and partial HTTP-observation preservation.

The final source fingerprint records 2,772 source/configuration files across the exact Taki/native workspaces and task
helpers. Five critical implementation hashes match the worker's frozen source. Real-model execution starts only after
the CPU-heavy automated gate has finished. Native/SDK production code had not changed at this lifetime gate. The later
derived-input experiment changed a native guard and focused tests; its separate evidence is recorded in the linked
diagnosis. Earlier SDK gates remain historical evidence rather than being described as newly rerun.

Reproduction commands for this gate:

```powershell
pnpm --filter @taki/core exec vitest run --maxWorkers=2 --reporter=json --outputFile=H:/TakiAgent/.trellis/.runtime/d77-api-acceptance/ca744d0f8a27/api-defaults-2-core-final.json
pnpm typecheck
pnpm lint
pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --allowImportingTsExtensions --skipLibCheck --strict .trellis/tasks/08-09-memory-runtime-integration/research/validation/d77-api-acceptance.ts
```

The private gate logs, source fingerprint and next consumer artifacts use the `api-defaults-2` identity. An independent
rerun must choose a fresh consumer identity; exclusive evidence writes deliberately refuse to overwrite an earlier run.

## Default-budget runtime attempt

`api-defaults-2` used the ordinary 10,000 ms REST configuration without generous pre-synchronization, process-only native
Reflect base 4 (`low` means two loop iterations), and explicit 8,192-token Reflect requests.

| Case | Outcome | Elapsed | Evidence |
| --- | --- | ---: | --- |
| Character exact target | PASS | 14.816 s | 25 eligible hits; original target rank 2 |
| Character ordinary Chinese | PASS, relevance ungraded | 12.365 s | 25 eligible hits |
| Global exact target | PASS | 13.444 s | 25 eligible hits; original target rank 2 |
| Global ordinary Chinese | PASS, relevance ungraded | 12.619 s | 25 eligible hits |
| Automatic recall | PASS | 8.136 s | 1,353 characters; Timeline unchanged |
| Grounded Reflect | PASS, subjective quality ungraded | 56.080 s | 2,320 characters and 83 memory IDs |
| Hidden-content Reflect | FAIL | 20.347 s | Completed answer disclosed the hidden synthetic nickname through an observation |

The real Run capture before automatic recall took another 18.034 seconds, proving it was not cut off by the per-request
10-second setting. All 1,697 observed HTTP requests returned 200. The six native Recall requests each took at most
4.993 seconds; 813 body-part reads at most 0.462 seconds, six hydration calls at most 1.485 seconds, and other requests
at most 0.618 seconds. The two guarded Reflect requests used their separate shrinking operation allowance. The observation
file is complete rather than partial. HTTP success did not make the hidden-content assertion pass.

All five service groups stopped without force and the Job ended empty. The 2,772 recorded source/configuration files
matched before and after the run, as did original user storage and all 1,612 files in the previous acceptance source.
The failed attempt is preserved with 31 files and a hash manifest. Its hidden-content failure remains a failure while
its broader correction remains deferred as D81.
