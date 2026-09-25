# Native Hindsight smoke — 2026-09-25 (runs 2026-09-25T20:00Z .. 21:28Z)

Harness: `research/native-smoke.mjs` (orchestrator), `smoke-core.mjs`, `smoke-native.mjs`, `smoke-fake-provider.mjs`,
`native_launcher.py`. Rerun: `node .trellis/tasks/09-25-hindsight-native-smoke/research/native-smoke.mjs` (about 3 minutes
with warm caches; writes `research/evidence/` and removes its temp root).

Evidence kept: `evidence/` = run 6 (final), `evidence-run5/`, `evidence-run4/` (each: `result.json`, `core-*.log`,
`native.log`, `native-egress.jsonl`, `provider-requests.json`, pg0 logs, `run-console.log`). The throwaway API key is
scrubbed from every copied log and `result.json`.

## Verdict

R4 steps 1-8 all pass in run 6. An extra probe step (6b), sending chat turns right after the ingestion, fails the same way
in runs 5 and 6 (run 4 hit the same cause and showed it as a timeout). Two product defects (D1, D2) and one logging gap
(D3) are recorded below. They are not fixed; the leader decides.

## Steps (run 6)

| Step | Result | Observed (RPC) | Native calls |
| --- | --- | --- | --- |
| 1 Boot, Legacy/empty | pass | `authority.mode=legacy-markdown`, `hindsight=null`, setup `unconfigured`, activation `run=null` | 0 |
| 2 Local onboarding + retaining Run | pass | prepare `ready` -> activate `activated`, marker `canonical-local`; `[retain]` Run completed, retain tool result `ok:true providerId=local` | 0 |
| 3 Connection + validate + apply | pass | `secret.set` source `catalog` health `ok`; `setup.validate` -> `compatible` rev 2; `setup.apply` -> `configured` rev 6; global + taki Banks `verified`; build `taki-memory-hindsight-0.9.0-d77-v1` | 25 |
| 4 `hindsight.activate` | pass | operation `completed` outcome `activated`; marker `hindsight` (epoch + lineage); runtime available; activation card `phase=activated status=completed` with receipt | 35 |
| 5 Capture + `replica.sync` | pass | `[retain]` Run completed (ack 7.4 s: first foreground pull); pending drained (0 on both Banks); `replica.sync` incremental + full on global and taki: 4/4 `completed`; second connection's `memory.operations.list/status` agrees on all 4 | 263 |
| 6 New Character mika | pass | degraded Run replied (ack 12 ms), no retain/recall tools, snapshot capabilities all false, Core warn `bank_not_ready`; automatic `bank.provision` (origin `automatic`) `completed` -> mika `ready`; `[recall]` Run completed with recall `200` on both mika and global Banks (2 each: automatic + tool); 8 filler turns reached the gate (request #18, range 9..28, keep/both); custody `pendingSpans=0` | 619 |
| 6b Probe: turns right after ingestion | **fail** | attempt 1: `chat.send` JSON-RPC `-32603 HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT` after 10.8 s; attempt 2 (5 s later): ack 28.3 s, 41 native `application-state/commits` during the ack; attempt 3: ack 1.0 s | 1142 |
| 7 Timeout change + revalidate | pass | `TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS=15000` -> `drift=config_changed`, runtime `unavailableReason=config_changed`, actions `revalidate:true`; `connection.revalidate` `completed` outcome `rebound`; fingerprint changed; runtime available; Banks unchanged | 8 |
| 8 Core restart | pass | clean exit 0 (not forced); reboot applied `[]`, head 50; authority identical; runtime available; Banks identical; 0 operation rows added or changed; 0 native calls during reboot | 0 |

"Ingested exactly once" (SQLite, read-only after teardown): the degraded user turn is `seq 9`. Exactly one mika span covers
it: `8 < 9 <= 28`, `state=complete`, gate `keep`, 2 receipts (global + mika). There are 26 mika primary commits; the first 8
recorded (`seq 9..16`) all carry that one `ingestion_span_id`, and no other mika span exists. Run snapshots: local-retain `local`; hindsight-capture `hindsight` (vector `degraded`); mika-degraded
`hindsight` with every capability false and vector `unavailable`; mika-recall full capabilities with vector `ready`.

Runs 4 and 5 agree on steps 1-5, 7 and 8. Run 5: first post-ingestion `chat.send` -> same `-32603` conflict. Run 4 (before
the fake provider fix, see below): the turn after ingestion got no `chat.send` ack for 60 s, while about 45 serial
bind commits ran (global, then mika).

## Defects

**D1 — a chat turn is refused when native consolidation races the foreground binding (reproduced 2/2).**
- Reproduction: steps 1-6, then send a mika chat within about 10 s of the ingestion gate, while native consolidation of
  the fresh units is running (native log: `CONSOLIDATION bank=... total_unconsolidated=10`, a bind commit on the same Bank).
- Observed: `chat.send` returns JSON-RPC `-32603` with message `HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT`. No Run is
  admitted and the user's message is not accepted. A later send succeeds.
- Expected: Run admission re-pulls and retries the binding, or degrades the Run the way `bank_not_ready` does. A native
  version race must never refuse the chat turn.
- Path:
  1. `packages/core/src/server/methods/chat-send.ts:63` calls `runs.admit`.
  2. `packages/core/src/harness/run-service.ts:76` calls `snapshot.capture`.
  3. `packages/core/src/memory/hindsight/hindsight-memory-runtime.ts:61-64` runs `captureRun` -> `synchronizeForCapture`.
  4. At `:82-89` only availability codes degrade; anything else is rethrown.
  5. `hindsight-application-sync-runner.ts:127-131` runs the bind loop with no conflict handling.
  6. `hindsight-application-binding-runner.ts:161-163`: a refused commit throws `HindsightApplicationRefusal`. The commit's
     `expected_native` comes from the pre-consolidation pull (`:86-95`).
- Related: two `MEMORY_PROVIDER_MAINTENANCE_FAILED` warnings for mika in the same window (`evidence/core-1.log`). Likely the
  same race on the maintenance path, retried automatically. Not proven.

**D2 — `chat.send` ack latency grows with the number of new native units and has no bound.**
- Observed:
  - Run 6: ack 28.3 s with 41 serial commit + incremental-pull rounds (about 0.7-1.3 s each).
  - Run 4: no ack within 60 s.
  - Ordinary turns: 0.25 s.
- Cause:
  - `hindsight-application-binding-runner.ts:73` selects `limit: 1` and returns after one commit (`:81`).
  - `hindsight-application-sync-runner.ts:127-131` pulls incrementally after every commit.
  - The foreground mode used by capture has no deadline and waits behind earlier work on the same Bank
    (`hindsight-runtime-bank-service.ts:68-73`, `:106-117`).
  - Routed Banks are processed one after another (`hindsight-memory-runtime.ts:86-89`).
- Expected: the chat ack is bounded. Binding is batched, or moved off the admission path.

**D3 (logging gap) — an unexpected handler error is returned as `-32603` but not logged.** `server/method-registry.ts:97-103`
does not log. D1 therefore left no trace in `core-1.log`.

## Native-side observations (not Core defects)

- **LiteLLM cost-map fetch at import.** Without `LITELLM_LOCAL_MODEL_COST_MAP=True`, LiteLLM tries to fetch its model cost
  map from GitHub at import time (`litellm/__init__.py:508` -> `get_model_cost_map.py:160`, httpx through the Windows
  system proxy `127.0.0.1:7890`).
  - The egress guard refused it in runs 4 and 5, and LiteLLM fell back to its bundled map.
  - Run 6 sets the variable and records zero refusals.
  - Recommendation: add the variable to the owner's native service environment.
- **Cold embedding load.** The first local embedding took about 11 s. In run 3 this made the automatic `bank.provision` hit
  `HINDSIGHT_TIMEOUT` (the default 10 s timeout); the operator provision recovered it. Runs 4-6 did not reproduce it.
- **Consolidation load.** During consolidation the native log shows `EVENT LOOP BLOCKED >= 1s` and DB pool acquire waits
  over 1 s. This adds to the D2 latency.

## Harness limitations and deviations

- **Mock LLM.** Native uses `HINDSIGHT_API_LLM_PROVIDER=mock`, so consolidation and fact extraction produce mock content.
  Recall is proven only as native `200` calls to both Banks plus a `ok:true` tool result, not by recalled meaning.
- **Scripted Core model.** The Core model is `smoke-fake-provider.mjs`. It acts only on a leading `[retain]`/`[recall]`
  marker in the typed text; injected `<turn-context>`/`<untrusted-observation>` blocks are stripped first. Run 4 used an
  older version that reacted to a marker echoed from recalled memory; that caused one extra recall turn in run 4.
- **`not_provisioned` not observed directly.** The automatic provision trigger had already moved mika to `provisioning`
  by the first status read after the degraded Run. `bank_not_ready` is proven instead: the Core warn log, and the degraded
  Run snapshot with every capability false.
- **Filler turns.** Ingestion only runs after 20 unprocessed entries, so 8 filler turns were needed to reach the gate.
- **Launcher changes (`native_launcher.py`).**
  - `winloop` is withheld, so every asyncio connect passes through the patched `create_connection`.
  - Shutdown uses a stop file plus a parent-PID watchdog, then in-process SIGINT, not a stdin reader: on Windows a pending
    synchronous stdin read blocks the numpy DLL load and deadlocked native boot in run 1.
  - `sys.argv` is set to `--host 127.0.0.1 --port <smoke>`.
  - The native sources are unchanged.

## Isolation, no-network, no-secret, teardown (run 6; runs 4 and 5 identical)

- **R1 isolation**
  - pg0 instance `taki-smoke-8d79febd978e`, data dir under the temp root, port 5612.
  - `~/.pg0/instances` is identical before and after (names + mtimes; the owner's 6 entries untouched). Only the smoke
    instance's registry dir and data dir were removed, after `stop` + `info` confirmed `running=false` at the owned path.
  - Ports: native 5610, Core 5611, provider 5609. None is 8974, 8888 or the owner's `.env` port (compared in-process,
    never printed).
  - Core `TAKI_DATA_DIR` was in the temp root. The owner's `~/.takiagent` listing (names + mtimes) is unchanged.
- **R2 no network**
  - Native: `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, a copied tiktoken cache, mock LLM. The loopback-only guard logged
    0 refusals in run 6; runs 4 and 5 logged 1 each, the LiteLLM fetch above, which was blocked.
  - Core: a guard on `net.Socket#connect`. Allowed only provider 5609 (11 connects) and native 5610 (2094); 0 refused. Zero
    connects after the restart.
  - Nothing was downloaded.
- **R3 no real secret**
  - Throwaway 32-byte native key, given to Core only through `secret.set` (`memory.hindsight.connection.api-key`).
  - The catalog master key is a random file in a temp `TAKI_CREDENTIALS_DIRECTORY`.
  - Windows Credential Manager was not touched. The provider key is a literal fixture.
- **R5 teardown**
  - Core exits 0/0, not forced. Native exited 0, not forced. pg0 was removed.
  - No listener on any smoke port.
  - Spawned pids (native redirector + base interpreter, both Cores) are not running.
  - Other new python pids seen at teardown were gone 5 s later.
  - The temp root was removed. No `G:/Temp/taki-native-smoke-*` is left.
