# W5 reentry candidate timeout diagnosis

Status: measured diagnosis delivered; scoped repair proposal awaits parent approval. No production repair or real delta retry is authorized by this report.

## Exact failure and persisted outcome

The real one-time renewed request was admitted. This is a new post-admission failure, not the previous stale-preview rejection.

- Transition: `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`.
- Core operation: `2e1846ad-3167-4e13-b60f-2b328d22979c`.
- Request / preview: `b13bf832-a118-4ba4-9092-58610cf18f66` / `5c4a768c-5900-498c-bb4b-42e083a883de`.
- Admitted: `2026-10-04T12:52:28.588Z`; `HINDSIGHT_TIMEOUT` at `12:57:06.624Z`, stage `candidate`.
- The subsequent abort refused with `MEMORY_TRANSITION_OUTCOME_UNKNOWN`, preserving the admitted intent and prepared effect.
- Core has one capture and one Character preparation, zero new delta results, Source uploads, native verifications, final native evidence or candidates.
- Delta operation: `6497dfc9-e287-4cb1-96b5-1020ea1eabc4`; request hash `946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.

The parent executed `w5-reentry-candidate-native-audit.py` against the stopped owned pair, with no HTTP, engine or model. The supplied supplemental audit was independently SHA256 checked:

`parent-native-audit-1d17df9a0a284fd0ac81df6b70782889.json` = `4562c3944ed7685ee3c616105ad2d1fe59ce153f2578f3afff8cbda81217dd25`.

Its exact delta query returned zero rows in 1.121 ms. Both new owners remain fenced, generation 1 / revision 2, without proof or outcome. No new maintenance, step or action exists; the original 92 completed steps / 769 actions are preserved. These facts establish the final persisted state after shutdown. They do not identify which HTTP handler was in flight during the failure.

The Native implementation writes native/application mutations and its immutable delta receipt in one transaction. No receipt exists after the stopped-server audit. Continue to use the original logical delta identity and ordinary recovery; do not renew admission again, reset the request, or blindly replay an uncertain effect.

## Offline inputs and restrictions

Only `.trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205` was used as corpus input. All nine original entries match `copy-manifest.json`; the parent audit is a separately hashed supplement. The copied SQLite SHA256 is `e800dc396be19e65b90edd789420e2a2e787a9ae83269892998f7233ace6dbd0`, 312,033,280 bytes. The real parent source hash is different: `5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3`.

The child has not accessed or started the real pair, PG, HTTP or any model. Original helpers/reports/source manifests and production files were not edited. New scripts, fresh derivative SQLite and measurements are diagnostic artifacts only.

## Reproducible Core dispatch-boundary measurement

Command: `node .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-candidate-core-diagnostic.mjs`.

Successful evidence: `.trellis/.runtime/w5-candidate-core-diagnostic-eefd6de7-d118-48d0-a4c6-332a2c987ed6/result.json`.

The script calls the real `executeTransitionDelta`, exact persisted preparation validator, Local dispatch guard, configuration/lease guard, capability validator and Hindsight request client. It uses a fresh SQLite derivative, historical clock and one explicitly recorded read override that answers the original terminal operation's state query as `running`. Request, preparation and lease bytes are not rewritten. This replays the pre-failure guard for measurement; it is not an actual recovery attempt.

The injected transport returns synthetic `null` for historical GET and a supported synthetic capability manifest. It stops immediately at POST handoff. No external transport is invoked, no delta result is committed and derivative integrity remains `ok`.

| Boundary | Elapsed time |
| --- | ---: |
| Exact preparation read/schema/signature validation | 488.9 ms |
| Historical GET response to next request context, including complete Local dispatch guard | 4,658.9 ms |
| Apply request schema/signature work before capability transport | 222.2 ms |
| Capability response validation plus POST encoding/handoff | 21.3 ms |
| JSON parse of 2,113,480-byte POST body at synthetic transport | 7.6 ms |
| Complete `executeTransitionDelta` to deliberate POST refusal | 5,296.3 ms |

Application bodies are 44 `memory`, 68 `memory_evidence`, 1 `block`, and zero `source_evidence`. The 68 `memory_evidence` entries trigger the independent capability GET. Native descriptors are 1,491 reuse / 68 upsert; application descriptors are 1,445 reuse / 113 upsert. Only 68 memory-unit rows are supplied; bank/documents/chunks/models/directives are absent or empty.

This feedback loop reaches and times the correct delta boundary but does **not** reproduce `HINDSIGHT_TIMEOUT`. It narrows the immediate Core guard/encoding hypothesis; it does not measure full driver concurrency, real socket delay or Native processing.

Harness preparation failures are retained separately: the first run stopped at a synthetic manifest with the wrong build; its guard measured 4,479.1 ms. A subsequent module import used a root-unavailable alias before being corrected to the exact relative schema path. Neither was a product failure or a successful end-to-end probe.

## Native pure codec and preparation measurement

Command: `H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reentry-candidate-native-codec.py`.

Evidence: `.trellis/.runtime/w5-candidate-native-codec-04be223173274d1c87791cd2394736c2/result.json`.

The exact real preparation request passes Native Pydantic validation and cross-language request-hash validation in all three repetitions. Parse costs 143.8–152.7 ms, signature costs 226.8–232.9 ms. Constructing 68 typed facts costs 0.51–0.61 ms when the embedding seam supplies synthetic vectors. No real embeddings or models are initialized; this does not measure their cost. Network connection attempts are hard-refused after Windows asyncio creates its internal socketpair; the successful run records zero such attempts. The initial harness refusal of that private socketpair is retained as harness evidence, not a Native failure.

## Actual Native read timing

Parent-approved script: `w5-reentry-candidate-native-timing.py`. The parent executed it successfully and supplied `parent-native-timing-ad45dcd8eb2a483393996e135bc21237.json`, independently hash-checked as `b597e603dc98df81c2de3158c25ba234daffd537e585bcee504fa68b07d61987`. Child did not execute it against the real pair.

The approved measurement ran Character `capture_transition_baseline`, exact old proof hash comparison, `preflight_transition_delta` and application `_predecessors` inside one read-only repeatable-read transaction. It rejects DML and explicit row locking before delegation and relies on PostgreSQL read-only enforcement as well. It constructs only the SQL memories-store adapter, with no engine, embeddings, HTTP or apply/admit call. The 180-second total and 30-second per-SQL diagnostic limits do not change any production TTL/deadline/lease.

Predictions supplied before execution:

1. Baseline/body validation dominates: `capture_transition_baseline` approaches/exceeds 60 seconds; SQL/CPU distribution identifies the read cost.
2. Preflight or predecessor repetition dominates: baseline is fast, subsequent stage is slow.
3. An individual query/database wait dominates: one SQL approaches 30 seconds or a query timeout occurs.
4. All read stages are fast: proceed to a separately scoped isolated apply/embedding/write or request-scheduling reproduction; do not claim the read path explains the failure.

Actual result:

| Stage | Actual elapsed |
| --- | ---: |
| Complete `capture_transition_baseline`, old baseline hash matches | 21.922 s |
| `preflight_transition_delta` | 1.195 s |
| Application `_predecessors` | 3.725 s |
| Total SQL time across all three stages | 8.720 s |
| Largest individual SQL | 0.539 s |

The probe executed 24,864 SQL calls. Body-descriptor queries account for 10,029 calls / 3.254 seconds; body-part queries account for another 10,029 / 3.029 seconds. The largest individual query reads ordered `memory_links`. Baseline output contains 36,070 auxiliary records, preflight has 1,559 native descriptors and predecessor validation has 1,515 existing application artifacts. No logical writes or model requests occurred; PG stopped, source preservation passed, cumulative real model count remains 301.

The observed read cost is material, with no long SQL or lock wait in this isolated read-only run. `apply` invokes baseline/preflight twice and `_predecessors` twice (once through application writing), then performs native writes, new application-body checks and a final complete artifact-body pass. Doubling the three measured stages gives approximately 53.684 seconds. **That is arithmetic over separate read measurements, not an actual full-apply time or proof of the historical failure.**

## Actual isolated full-apply measurement

The parent approved and executed the proposed single-clone measurement with `w5-reentry-candidate-native-clone.py`. The stopped source had 1,660 files / 550,592,708 bytes, with no reparse points or external tablespaces. The script verified every source/copy hash, used an exclusive clone and separate loopback port, constructed fresh clone-only authentication without loading source credentials, and started only the clone. The child read the permitted result, not its database.

Result: `.trellis/.runtime/w5-candidate-native-clone-22efe32ae26c4938b6bf3edfd36c8278/result.json`, independently verified SHA256 `45aa7df021304e1fe8891a2087357d48c2ab8d2e2f0876d056cfe70a2da5645d`.

| Stage | Actual elapsed |
| --- | ---: |
| First baseline | 30.564 s |
| First preflight | 1.378 s |
| First application predecessor validation | 4.821 s |
| Typed preprocessing with synthetic vectors | 1.97 ms |
| Second baseline | 30.336 s |
| Second preflight | 1.346 s |
| Native row/entity/link writes | 12.409 s |
| Application writes, including second predecessor pass | 12.623 s |
| Second predecessor pass, included in application write total | 5.003 s |
| Actual full `apply` | **94.569 s** |

The **60.382-second observation was pending inside the second `_admit` / baseline**, with a body-descriptor SELECT in flight. No native/application write stage had started. Two complete baseline passes alone took **60.900 seconds**. This demonstrates a concrete pre-write request-budget overrun in the real apply path for the copied corpus; it is independent of later synthetic-vector-dependent writes.

The first read transaction completed in 36.828 seconds; the second read/write transaction took 57.324 seconds, with a 9.04-ms transaction exit. Internal Native renewals succeeded in approximately 15–29 ms. This fixture does not show a renewal deadlock or slow COMMIT. Across the entire probe, body descriptor/part queries each ran 21,758 times and together consumed 30.371 seconds of SQL time. Statistics include the explicitly recorded before/after diagnostic reads; stage timers isolate the apply itself.

Normal clone claim advanced executor generation to 2. The exact delta operation/request hash remained unchanged; one receipt committed, lookup matched, and the result covers 1,559 mappings / 1,558 artifacts. The root's `applyElapsedMs` also includes the subsequent lookup; use the `full-apply` stage for the 94.569-second figure. Original maintenance fingerprints, source files, offline inputs, real Core and preserved originals all match. The clone stopped and was retained; parent confirmed no owned listeners.

**Interpretation limits:** this is an actual service/SQL apply whose 60-second budget is exceeded, not a replay of the original HTTP timeout. The diagnostic allowed 180 seconds so it could expose later stages. The original endpoint is still unlogged, and the stopped real pair has no delta receipt. All supplied vectors are the same synthetic 384-dimensional vector; this changes semantic links and can affect the later write times, so those write times are not a strict lower bound for real embeddings. The pre-write baseline overrun does not depend on those later writes. No real LLM or embedding model was used and cumulative real model count remains 301.

## Concrete next action

See [w5-reentry-candidate-timeout-repair-proposal.md](w5-reentry-candidate-timeout-repair-proposal.md). It proposes a delta-only baseline reader with bounded raw storage prefetch and invocation-local verified immutable-byte reuse. Every `read_body` still creates a fresh typed result and checks Source dependencies; both `_admit` transactions independently reread and validate complete evidence. No cache is passed into writes or across transactions.

The proposal identifies four Native production files, focused regressions, corruption/mutation/closure/resource safeguards, default ordinary-store equivalence and a fresh-clone performance gate. No proposed production edit, timeout change or real recovery has been performed.
