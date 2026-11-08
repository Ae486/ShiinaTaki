# Real-model continuation result — 2026-11-06

## Current continuation — 2026-11-07

The owner-approved prompt correction is implemented. Managed v3, main-model guidance and the explicit
`retain.context` cue passed scoped checks and independent review. Final run `sIlbXB` passed all six integration
scenarios, the real-role gate and targeted semantic review across Local/Native/derived/final-answer stages.
See [the current prompt correction record](prompt-grounding-20261107.md) for exact evidence, the preserved
harness/context failures, the independent Pending-narration limitation and remaining acceptance boundaries.
Original data remains untouched; this bounded result does not close the entire parent task.

## Previous result — 2026-11-06

Latest completed real run: `G:/taki-real-memory-Ld9jwy`: **all six integration scenarios and the real-role gate
passed; semantic accuracy is still not accepted**. Total run time including startup/cleanup was 293.334s.
The eight genuine input messages and the frozen source (`source-tested-3.json`: 1,831 Taki paths, 879 Native
paths and four harness files) were unchanged on final readback. There were 51 observed model requests and
101,056 reported Native tokens; Core streaming token usage remains unknown.

| Stage | Observed result | Time |
| --- | --- | ---: |
| Local study retain / recall | Passed with persisted Local source | 6.210s / 2.365s |
| Template apply / activation | Completed, then immediate first Hindsight chat | 30.344s / 53.482s |
| Hindsight Global retain | New request, original parent/Native completion proven | 9.187s; chat admission 0.502s |
| Global Pending settlement | Registered incremental sync; original write drained | 13.507s |
| Hindsight repeated study retain | Explicit new write despite imported older copy; completed original receipt | 6.317s; chat admission 0.520s |
| Study Pending settlement | Registered incremental sync; original write drained | 24.477s |
| Fresh-Character Global recall / study Character recall | Correct Bank/new-document hits and nonpartial tool data | 12.974s / 14.861s |

Intermediate sync operations truthfully reported `HINDSIGHT_PENDING_REMAINS` before later completion; they were
not hidden as drained. No retain returned an availability error. The expired-recovery branch is established by
the deterministic regression; this run did not require a second Global retain and does not independently exercise
that exact timing branch. It also does not replace fault/restart, owner UI, original-data activation or large-data
performance acceptance. Core and Native exited with code zero, the owned PG instance stopped and its owned data
was removed by the existing harness, and independent live readback found no owned processes/listeners.

Content inspection found that Local and Hindsight source text preserved the historical date and the difference
between afternoon study and an evening plan. However, the final Character answer promoted a historical assistant
question about another study pass into the user's actual ongoing study state, and the Global answer extended the
user's conditional delegation suggestion into an unsupported converse preference. Passing the regex/receipt
predicates does not close this source-attribution gate. Independent read-only review confirmed two producer gaps:

- The Character write `3aae5c27-c00b-4522-ba54-052b85155d15` preserves speaker attribution, but Native extraction
  unit `11924f31-07ee-4264-8a2f-f292f90db738` already turns the assistant's question into a user-state assertion.
  Its original `application-native-record.v1` body `31aa1f3b-f4a5-41ff-b661-f37c296bdb89` has revision 1,
  native cursor 14 and `consolidated_at=null`. The later revision and derived observation inherit the assertion;
  actual recall at Timeline seq 27 returns it. This establishes extraction as the first producer, before Core
  projection or final answer generation.
- Final Character answer seq 28 adds a further supposed prior user plan absent from the seven recalled records
  and original user messages. Global answer seq 24 likewise adds the unsupported converse rule absent from the
  source and both recalled records. Final-answer grounding is a separate remaining defect.
- The Global answer also mistakes a source fact plus its explicitly linked derived observation for duplicate
  writes. There is only one Global retain (`638b178c-8f82-4f28-bccd-9ae64040fc14`). Its attempted invalidation
  at seq 22 receives `MEMORY_CAPABILITY_UNSUPPORTED` at seq 23, with no new mutation parent. The existing prompt
  allows read-time maintenance; the demonstrated error is an unfounded duplicate diagnosis, not evidence of a
  newly discovered authorization bypass or duplicate dispatch.

Inspect Native extraction's handling of speaker attribution/questions/unconfirmed premises and the final model's
distinction between recalled facts and its own suggestions. Existing truthfulness instructions already express the
general rule. Do not add phrase-specific rules, remove the difficult source, or rerun the whole journey without a
relevant correction. Native source was not changed in this follow-up.

### Previous deadline failure and correction

`G:/taki-real-memory-QNS8Ho` failed in the first Hindsight chat.
Local retain/recall passed; setup validation took 0.306s, template apply 27.844s and activation 64.110s.
The following chat was admitted in 1.013s with memory tools. Its first retain returned a durable Pending receipt
after 3.402s. The model then repeated retain with a new request identity; this second call failed with
`MEMORY_PROVIDER_UNAVAILABLE` after 10.057s. Thus the first request was accepted; the chat-level failure must not
be described as absent memory tools or failure of that first admission.

Read-only inspection found both parent write intents and their Pending rows. The first child was submitted and
Native extraction/consolidation completed; the second child remained queued with zero dispatch attempts. No
completed parent receipt is claimed. Native continued application-state work during the second call. The public
error records only the generic availability category; it does not preserve the exact internal timeout location.

A deterministic in-memory reproduction confirms a write-result defect consistent with that timing: in
`memoryWriteFixture`, use `requestTimeoutMs=10000` and make `beforeRecovery` throw `HINDSIGHT_TIMEOUT`. Before
expiry the gateway returns Pending; advancing `Date.now()` by 10001ms before the same throw makes it throw timeout,
although both cases retain the identical queued child and nonterminal parent, with no Native dispatch. The catch
and final readback in `hindsight-memory-writes.ts` both called the already expired write-context deadline. The narrow
correction now separates current identity/cancellation checks from the recovery allowance; it does not extend the
allowance or claim that queued work has completed. Its original RED reproduced ten failures; the final 14-case
deadline suite and 54-case related group pass, as do Core typecheck, scoped lint and independent review. These
checks cover original-identity recovery, pure-layer mutation, terminal results and preservation of cancellation,
Authority, integrity and unknown errors. Logs are under `G:/taki-real-memory-checks-20261106/write-receipt-*`.
The follow-up real run uses `source-tested-3.json`; complete real-model acceptance remains open.

This run used the latest base truthfulness boundary and the clarified fourth-turn repeat-write request. It stopped
before that fourth turn, so the repeated study-write correction has no new real evidence. The Local text removed
the prior reaction/habit narration but introduced an unsupported relative ordering inside the dated study slice;
semantic precision is not accepted. There were 33 observed model requests and 74,942 reported Native tokens;
Core token usage remains unknown. Source comparison matched all extant files and the three expected deletions in
`G:/taki-memory-continuation-m3_1cs0i/source-tested-2.json`, plus all four harness files. Core/Native exited normally,
the owned PG instance stopped, and live readback found no owned PIDs or listeners on 14173-14175.

### Previous activation-correction run

`G:/taki-real-memory-WLbnTi` failed at the fourth chat scenario. The completed correction passed 91 focused Core
cases, three Shared action-schema cases, Core/Shared typechecks, scoped lint, and independent final review.
The separate prompt correction passed 69 existing cases. Frozen source evidence is
`G:/taki-memory-continuation-m3_1cs0i/source-tested.json` (1,830 Taki paths, 879 Native paths, four harness files).
The first Hindsight retain followed activation immediately, without a harness warmup. Activation completed in
60.092s and that chat was admitted in 1.068s with memory tools; the actual Global write and its original Native
receipt completed, followed by a 22.977s registered incremental sync. The original premature-completion failure
did not recur. Local retain/recall also passed. The fourth chat successfully recalled the imported study memory
but the model refused another write as duplicate; `REQUESTED_TOOL_NOT_PERSISTED` correctly failed the run.
This is a model choice, not another timeout or unavailable-tool error. The final two recall scenarios were not run.

The role gate was exercised, including the explicitly identified `canonical-write-gate` producer; actual retain
description and content-field hashes matched the current source. The Local record preserved its historical date
and plan, but still added unsupported reaction/habit narration. Content precision remains failed. All owned
services exited normally; no owned listeners remained. The attempt made 39 observed requests and reported
76,358 Native tokens; Core token usage remains unknown.

The next input revision kept all eight genuine source messages byte-identical, clarified that the repeated study write
is explicitly requested despite the imported duplicate, and applied one base truthfulness boundary separating
conversational persona from fact-bearing memory arguments. Preserve the failed ordinary repeat-request observation;
the clarified input does not retroactively turn that refusal into success. Changes leading to `QNS8Ho` were limited
to that prompt boundary/index and the task-only repeat-intent wrapper. Full real-model acceptance remains open.

### SHA-256 and waiting evidence

The Core profile from `WLbnTi` covers 170.095s: 140.302s idle, 0.605s in identifiable hash primitives (0.36%),
and 2.714s in project functions named for hashing/digests including their callees (1.60%). Groups overlap and must
not be summed; the latter includes surrounding work and is not pure SHA-256 time. See the private run's
`cpu-summary.json`. This bounds the claim to one small Core workload, not Native/Python or a large owner database.
File hashes used to freeze this experiment's source are outside the chat/runtime process. Repeated reconstruction
and serialization of large data remain investigation targets; these samples do not justify removing integrity checks.

The older `pF99hq` Native trace separately resolves to one startup verification (59 tokens), four Reflect executions
(20 requests, 65,962 tokens) and one consolidation (4,119 tokens). Two Reflect executions occurred during template
setup and two during post-import cutover verification. This is measurable serial model-generation cost, not 21
connection checks. Deferring initial empty-Bank generation is unproven against the template/readiness contracts;
no Native optimization was made. Details are in `real-admission-review-20261106.md`.

### Recovered attempt and implementation background

Recovery session `01a1b0b3-50c6-7ef0-8415-89cf106a062c` resumed the interrupted session below and rebound the
existing task in `H:/TakiAgent`. The last attempt, `G:/taki-real-memory-pF99hq`, finished after that session's
transport failure. Local retain/recall, setup and activation completed; the first Hindsight chat was admitted
without memory after the 7.5-second foreground synchronization budget. Its persisted `retain` result is
`AI_NoSuchToolError`; the harness incorrectly parsed that error text as JSON and reported `SyntaxError` instead.
This is not an upstream generation failure. All owned processes stopped normally and no listeners remained.

That run's effective retain-description hash matches the pre-continuation production correction, but its private Local result
still adds an unsupported emotional interpretation. Historical date preservation passed for that observation;
semantic precision did not. Also, the observer classified a memory-unavailable primary request as Utility solely
because it lacked memory tools. Its Utility counts are not reliable evidence. These failures remain explicit
while the decoder, role observation and post-activation readiness boundary are reviewed.

The continuation now fixes that first-use boundary through the existing durable `binding`/`completed` producer
checkpoint. New activation and same-receipt recovery await the required Banks before completion. Preparation uses
the existing owned foreground synchronization mode: the configured 10-second REST timeout remains per HTTP call,
not a new total queue-plus-preparation deadline. No readiness cache, parallel readiness predicate, new persistent
state or blanket timeout increase is introduced. Its focused regression and subsequent six-turn technical gate
passed as recorded above; content accuracy remains open. See `real-admission-review-20261106.md` for the evidence
and tradeoff.

Official-API continuation: the owner changed the supplied configuration to `https://api.deepseek.com` /
`deepseek-flash`. Text, tool roundtrip, full streaming and Native structured output now have successful official
observations; one Native preflight 503 was retained before a successful recheck. See
`model-connectivity-official-20261106.json`. The former TLS failure no longer blocks this configuration.

The first official live run `G:/taki-real-memory-X0GDzD` passed Local retain/recall, Hindsight setup/activation
and Global retain with actual Native extraction/consolidation. A registered incremental sync completed the same
Pending in 19.946s. Passive test waiting had incorrectly assumed faster-than-six-hour background scheduling;
the next harness explicitly records Sync-now. It then exposed a Local-only Bank-table assertion for a Hindsight
epoch; that assertion now uses the real Hindsight Bank/read-model and original completed receipt/document.
All owned services exited normally. This incomplete attempt is not a full pass.

The official sample still promoted assistant interpretations to user habits/preferences. A narrow production
prompt correction now reuses the shared eligibility/voice rules in foreground retain, with explicit attribution
and one-off/plan distinctions. Related 61 tests, Core typecheck and scoped lint pass; actual content precision
still requires the next real run. Write/mention metadata keeps its existing current-time contract; historical
dates are preserved in content/context, not inferred as a metadata backdating requirement.

The finite six-turn gate now admits up to 96 provider attempts / 250k observed Native tokens, grounded in the
76,889 Native tokens measured after three turns of the first official run. Core stream usage remains unknown;
these thresholds are admission controls, not a promised total cost cap. The generous time windows are retained.

The current task is `08-09-memory-operations-ui` in `H:/TakiAgent`. Its previous Codex session was
`01a1afc5-3141-74c1-9c9b-04c9cd5fe590`; its recovered source session was
`01a1abc7-4bec-78c2-b97a-1b5699143b96`. The t4 worktree supplies only `.env.local` model configuration.

The earlier controlled-model journey 17 completed all 20 scenario entries, including healthy return/re-entry,
emergency Local restart and offline paired restore. Recovery-time readback matched its 204 extant Taki changed-source
hashes, three expected deletions, 97 Native hashes and both HEADs. The subsequent prompt/activation delta requires
its own current-build evidence; the old run is not a claim that all present source hashes are identical. Its result is
`first-use-runtime/results/2026-11-05T18-51-25.420Z/result.json`; it is not real-model acceptance.

Real Local and Hindsight retain/recall now have passing six-scenario integration evidence. **Complete memory
acceptance remains incomplete** because semantic attribution and the separately scoped acceptance boundaries remain
open. Earlier relay attempts exposed a corrected harness proxy omission
and later TLS failures; they are historical evidence below. Source-attribution precision is a separate gate.
Production changes now include source-grounding guidance and the reviewed initial-activation completion/recovery boundary. Owner databases,
global proxy configuration, Git commit/push and task archive remain untouched. Work remains in progress.

## Model and transport evidence

The earlier relay-selected main model was `deepseek-v4.1-flash`. Initial installed-SDK text, complete streaming and one actual
tool roundtrip passed; the responses that exposed a model identity reported `deepseek-flash`. The actual Native
`OpenAICompatibleLLM` adapter also validated a Pydantic JSON response without retry. These are small compatibility
observations, not reliability or memory-quality acceptance. Details: `model-connectivity-20261106.json`.

The configured vision model `gemini-2.5-pro-1m` returned HTTP 503 `model_not_found` / no available account channel.

Later transport checks failed before generation:

- Installed SDK direct and environment-proxy probes: connect timeout at about 10.7s, no HTTP response.
- Curl, with a 90s connect allowance, reached TCP in 0.035s directly and 0.002s through the existing local proxy;
  both failed TLS handshake around 61.2s, with HTTP status `000` and no first response byte.
- Local DNS returned `198.18.0.85` (Fake-IP routing). An independent public DNS query succeeded. Two bounded
  probes using public DNS addresses while preserving the original TLS hostname also failed TLS within their
  20s diagnostic allowance. No DNS, hosts file, proxy rules, services or certificates were modified.

This proved a failure on the earlier relay path before HTTP/model generation. It did not identify whether the failing component
is the local proxy/TUN route, an intermediate network, or the upstream gateway. Do not describe it as slow model
inference or a memory runtime failure. The later official endpoint has independently passed connectivity.

## Real attempts and timing

The private input is `G:/taki-memory-real-input-jwav_sy8/conversation-fixture.json`: eight real user/assistant
messages in two slices, extracted with read-only SQLite queries. Original IDs/timestamps/content hashes are retained.
Final read-only verification matched all eight source hashes. No full owner database was copied or booted.

| Attempt | Observed result | Evidence |
| --- | --- | --- |
| `OckQlQ` | Local retain/recall passed. `setup.apply` failed after 120.242s with `HINDSIGHT_TIMEOUT`: Native httpx discovered the Windows proxy at `127.0.0.1:7890`, which the isolated test guard refused. These Native attempts did not reach the model. | `G:/taki-real-memory-OckQlQ/result.json` |
| `b12PQk` | Corrected approved-host `NO_PROXY` configuration produced no egress refusals. Native connection verification failed three times around 61s; the first Core turn then failed after three approximately 10.7s connection attempts, returning `PROVIDER_ERROR`. | `G:/taki-real-memory-b12PQk/result.json` |

Both attempts stopped Core and Native normally, removed only their owned stopped PG instances, and left no owned
listeners. The first took 286.877s including setup and teardown; the second took 285.042s. Private logs/data remain
under their owned G: roots for diagnosis; public result files exclude dialogue and keys.

For the successful Local cases, intersect each request's start/finish interval with the turn and take the interval
union; overlapping requests are not summed:

| Turn | Wall time | Within observed upstream request intervals | Outside those intervals |
| --- | ---: | ---: | ---: |
| Local study retain | 59.066s | 52.772s | 6.294s |
| Local study recall | 34.306s | 34.194s | 0.112s |

The final column includes client retry gaps and other work. It is not a CPU measurement or a claim that all of it
belongs to memory. Native extraction/consolidation and complete Hindsight stage timings are still unverified.

## Content precision is a separate failed gate

The study user's subject/time-of-day statement was stored and retrieved, but the stored text and subsequent answer
also promoted topics present only in historical assistant messages into user facts, and inferred a stable emotional
preference not stated by the user in this slice. Those topics might be true in earlier history; this bounded input
does not support that attribution. Retrieval success does not close content precision.

The first envelope also omitted original timestamps despite retaining them in fixture metadata. Current harness
source now quotes original role, timestamp, sequence and content for all eight messages, without removing difficult
assistant material. Event-date correctness must be retested; it was not established by the previous runs. See
`real-content-semantic-review-20261106.md`. No new production validator or speculative guard was added.

## Delivered harness and budgets

Task-only changes: `first-use-runtime/real-model-memory.mjs`, `real-model-native-launcher.py`, and optional real-mode
parameters in the existing `smoke-core.mjs` / `smoke-native.mjs`. Controlled defaults remain intact.

- Real main/utility and actual Native `openai` adapter; cached local embedding/reranker evidence is observed separately.
- Transparent request/header/first-chunk/EOF/error timing; no response aggregation or replacement model output.
- Failed/unknown Pending cannot count as drained. New Hindsight retain proof joins the actual request, Bank, epoch,
  terminal receipt and completed Native child; old imported Local documents cannot prove a later write.
- Native returned model identities are separate from unobserved Core stream identities. Core token usage stays unknown.
- Model request outer timeout 240s; Native LLM timeout 240s; supported policy Utility timeout 240s; Chat/operation
  observations 900s; Native boot observation 900s; real-mode graceful stop allowance 300s per process.
- A finite six-turn scenario has a 60-minute new-scenario admission window and observed 96-request/250k-token
  admission thresholds. Already admitted work can settle afterward; these are not hard total wall-clock/cost caps.
- Existing caller cancellation and transport connection limits still apply (observed Core connect limit 10s,
  Native connect failures around 60s). The failed 90s-allowance TLS probes show that increasing generation waits
  alone does not resolve the current network condition. Unrelated lease/quiescence and production setup budgets
  were not changed. The earlier relay-specific timeout observations do not describe the now-working official endpoint.

Final local checks pass: three JS syntax checks, Python AST, content-free no-service self-check, documentation
whitespace checks and eight original source hashes. Independent source review findings were checked and repaired;
real functionality is not inferred from that review. Resolved versions: Node 24.18.0, pnpm 10.22.0, AI SDK 7.0.17,
OpenAI-compatible SDK 3.0.5, Native Python 3.11.5. Current source after the final timestamp/error-evidence fixes has
had subsequent official runs as recorded above; complete real-model acceptance is still open.

## Exact next step

1. Trace the remaining `Ld9jwy` attribution errors from the original role-labelled input through stored sources,
   extracted/derived records, recall tool data and final answers. Do not treat correct transport as semantic acceptance.
2. Correct only a demonstrated producer/prompt responsibility gap. Preserve the genuine difficult input, original
   receipts and role evidence; do not add another validation framework or tune isolated words for a superficial pass.
3. Run the same finite harness only after a relevant correction, using the authorized official endpoint and isolated
   G: data. The command remains `node .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/real-model-memory.mjs`.
4. Retain existing controlled transition/restore evidence. Owner UI, original-data activation, complete remaining
   recovery coverage and D94-D96 remain separate. No commit, push, archive or original-data operation is implied.
