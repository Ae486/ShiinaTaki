# Repeated Core lifecycle observation

Date: 2026-11-10. Workspace: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. This is the remaining repeated-change check
for the existing flow/live-configuration task, not a new product scope.

## Initial mixed-cohort result and boundaries

Thirty measured cycles plus three warmup cycles passed through the actual Core
process and its public RPC interface. Each cycle changed the Main model, completed
one local-provider chat, changed ordinary policy and the search stoplist, replaced
the listener, reconnected the same device and proved the retired port refused TCP.
The final Core shutdown was graceful, exit 0, with both listener ports closed.

The observed event-loop resource counts stayed stable. This establishes bounded
listener/socket behavior for the scenario; it does not establish universal memory
reclamation. RSS and used heap increased between the naturally collected baseline
and the last idle window. No forced GC was used. Long-duration memory acceptance
therefore triggered the targeted configuration-only cohort recorded at the end of this report; the original increase remains explicit below.

No production source, real profile, OS keyring account, Hindsight module, paid
provider, Git commit or task archival was changed by this check. The fixture used
explicit loopback operator trust and an unavailable credentials-directory source;
native authentication is covered by the separate native report, not this probe.

## Reproduction and environment

```powershell
node .trellis/tasks/11-09-installation-user-experience/research/repeated-lifecycle-20261110.mjs
```

- Node `v24.18.0`, Windows; actual production Core entry `packages/core/src/main.ts`.
- New isolated profile and deterministic OpenAI-compatible loopback provider.
- Helper path explicitly empty; no `.env` loader, inherited `TAKI_*` configuration
  or real provider endpoint. Utility, initiative and ambient screenshots disabled.
- A fixture-only IPC preload sampled the public `process.cpuUsage()`,
  `process.memoryUsage()` and `process.getActiveResourcesInfo()` APIs.
- Startup issued zero provider calls. The 33 chats issued exactly 33 requests:
  17 to `lifecycle-model-a`, 16 to `lifecycle-model-b`; all streamed successfully.
- Three warmups, six seconds settling, 30 seconds idle, three ten-cycle blocks
  separated by six-second settling, then 30 seconds idle. No forced GC.
- Total duration **98.70 seconds**, including **3.59 seconds** startup.
- Root paused desktop performance sampling during this probe. Native functional
  UI work could occur concurrently; these are Core-process measurements, not a
  system-isolated benchmark or a native UI performance claim.

Evidence root:
`G:/taki-native-flow-artifacts-20261110/repeated-lifecycle/73973242-ea2f-421f-a335-fbc850bacb51/`.
`evidence.json` contains actual samples, per-cycle timings and assertion results;
`core.stdout.log` and `core.stderr.log` preserve isolated-process diagnostics.
Provider request bodies and device credentials are not included in the report or
evidence JSON. The fixture directory remains available for reproduction inspection.

## Functional and lifetime evidence

For every cycle:

1. Apply a complete keyless Main profile with the current revision. Read-back is
   applied and the next actual request carries the selected model ID.
2. Send the next message to the same Character using the normal conversation owner;
   observe `chat.complete` for its exact message ID and exactly one provider request.
3. Set `TAKI_MAX_STEPS` and alternate `TAKI_MEMORY_STOPLIST`; wait for the actual
   applied stoplist observation before replacing the listener. The final scalar
   application observation matches its requested value.
4. Change the Core port between two unique fixture ports, reconnect with the same
   device ID and token, wait for applied listener state, then observe `ECONNREFUSED`
   at the retired port. A timeout never counts as proof that a port is closed.
5. Subscribe twice to model-profile/config changes on each new physical socket.
   Each model-profile save produces one notification. Scalar notifications are
   invalidations across persistence/application phases; all cycles observed three.
6. Confirm `run.queue` is empty with no cursor and active Memory Operations are
   empty. The complete persisted device file remained byte-identical throughout
   the listener/reconnection cycles.

After the final idle window, the fixture sent its existing SIGTERM shutdown path
through IPC. No forced-stop fallback was needed; exit code was 0, and both ports
refused connection after process exit. The local HTTP provider also closed.

## Timing observations

Thirty measured cycles; median uses the two central observations and p95 uses
nearest rank. Values include the driver/RPC path. The stoplist measurement includes
50 ms observation polling, and reconnect includes application/idle confirmation.

| Operation | Median ms | p95 ms | Max ms |
| --- | ---: | ---: | ---: |
| Main profile read/apply | 6.59 | 10.39 | 12.42 |
| Actual local chat completion | 69.94 | 99.59 | 101.74 |
| Stoplist write to observed application | 193.16 | 272.34 | 283.33 |
| Listener replacement/reconnect/confirmation | 18.11 | 75.06 | 77.33 |
| Whole cycle | 321.69 | 403.89 | 422.49 |

The first ten measured chats had a median of 72.80 ms; the last ten were 64.33 ms.
That observation does not show increasing request latency in this bounded run,
but it is not a before/after implementation performance comparison.

## Resource observations and unresolved memory question

All 12 post-settle samples had exactly:

```json
{"PipeWrap":3,"TCPServerWrap":1,"TCPSocketWrap":1}
```

These are resource types keeping the event loop alive. The three pipe handles are
part of the fixed fixture IPC/stdio setup. This public API does not enumerate all
unref'd timers, JavaScript subscriptions, model objects or native allocations.
Neither absent `Timeout` entries nor stable socket counts prove those other owners
were reclaimed. The retired-port probes directly establish listener release.

| Sample | RSS MiB | Used heap MiB |
| --- | ---: | ---: |
| Warmup settled | 282.98 | 131.97 |
| End of initial 30-second idle | 196.09 | 111.29 |
| After ten measured cycles and settling | 244.11 | 133.74 |
| After twenty measured cycles and settling | 214.42 | 127.50 |
| After thirty measured cycles and settling | 260.66 | 154.21 |
| End of final 30-second idle | 260.66 | 154.27 |

The initial idle window consumed **484 ms CPU over 30.03 seconds** and included a
natural reduction in used heap/RSS. The final idle window consumed **0 ms reported
CPU over 30.03 seconds**, with stable RSS and approximately 0.06 MiB heap growth.
CPU time resolution and the low-frequency sampler remain measurement limits.

Relative to the initial idle endpoint, the final endpoint is approximately
**64.57 MiB higher RSS and 42.98 MiB higher used heap**. The process also accumulated
30 additional real Run/conversation/history records, and the GC points differ.
This sample cannot distinguish expected retained conversation state and pending
collection from an unintended reference. No leak conclusion, memory improvement,
long-duration stability claim or artificial acceptance budget is assigned.

## Probe correction and checks

The first attempt stopped during warmup because the driver incorrectly required
one scalar notification per `config.set`. Live evidence showed three; source
inspection of `config-application.ts` and the config writer confirmed the distinct
application and persistence invalidations. The scalar payload is an invalidation,
not a one-event-per-write contract. The driver now records those counts and asserts
the actual applied value. The existing exact-one model-profile subscription check
remains. This corrects the probe's expectation, not application behavior.

That first attempt's evidence is preserved at
`repeated-lifecycle/a4c9da90-0139-4913-a4d3-6e893377b36a/`; it also shut down cleanly.

- `node --check` on the new driver passed.
- Standalone ESLint with `@eslint/js` recommended rules and explicit Node globals
  passed with zero errors/warnings. Root lint intentionally ignores task research
  scripts, so this was an explicit script check, not a false-green ignored-file run.
- The actual final probe passed all scenario assertions and cleanup checks.
- No typed production code changed; existing workspace typecheck/full-suite results
  were reused rather than rerunning them without a change. The independently owned
  Hindsight function-length finding remains outside this check's ownership.


## Targeted configuration-only cohort

The mixed cohort did not isolate configuration lifetimes from chat request/replay
allocation. The integration owner approved one additional bounded cohort without
chat or growing conversation history. This is targeted disambiguation of the
observed heap increase, not an unbounded performance rerun.

```powershell
node .trellis/tasks/11-09-installation-user-experience/research/repeated-lifecycle-20261110.mjs configuration-only
```

The driver has an explicit mode and records it in evidence. This cohort uses a new
isolated Core, three configuration-only warmups and 90 measured cycles in three
blocks of 30. Each cycle applies an alternating Main profile, ordinary policy,
stoplist and listener change; it reconnects the same device and confirms retired
listener refusal. The branch never sends chat or model-test RPC. Provider request
count is asserted to remain zero. Settling, initial/final 30-second idle windows,
public telemetry and graceful teardown match the first cohort; no forced GC.

Result: **90 measured cycles passed, zero model calls, 105.72 seconds total**.
Device-file bytes stayed identical; no active Run/Memory operation remained at
cycle boundaries. All 12 settled resource samples stayed at PipeWrap 3,
TCPServerWrap 1 and TCPSocketWrap 1. The child exited 0 through the normal SIGTERM
path, without forced stop, and both ports refused connection afterward.

Evidence root:
`G:/taki-native-flow-artifacts-20261110/repeated-lifecycle/c53778d2-5c94-49f1-811c-6f8485b67321/`.
The real `evidence.json` records `mode: configuration-only`, 90 measured cycles,
empty `providerRequests`, complete sample values and successful cleanup.

| Configuration-only sample | RSS MiB | Used heap MiB |
| --- | ---: | ---: |
| Warmup settled | 259.68 | 138.16 |
| End of initial 30-second idle | 188.54 | 105.32 |
| After 30 measured cycles | 224.41 | 120.66 |
| After 60 measured cycles | 247.68 | 133.81 |
| After 90 measured cycles | 254.96 | 105.01 |
| End of final 30-second idle | 254.96 | 105.11 |

The naturally collected heap after 90 reconfigurations returned to its baseline
(105.11 versus 105.32 MiB at the final idle endpoints). No cumulative retained-heap
growth was observed in this configuration-only cohort. The mixed cohort's higher
endpoint is therefore not reproduced merely by repeating profile, policy, index,
listener and reconnect operations. This does not prove that its extra allocation
is retained conversation history or that all request-related references are safe.

RSS stayed 66.42 MiB above the post-GC baseline but below the warmup value
(254.96 versus 259.68 MiB); used heap did not track that difference. RSS includes
allocator/native resident state and this result cannot assign its exact owner.
It does not show an unbounded RSS trend or establish a universal memory budget.
Final 30-second idle CPU was 0 ms reported; initial idle CPU was 453 ms and included
natural memory reduction. Long-duration native/whole-application acceptance remains
separate, with both cohorts' raw values preserved.

| Configuration-only operation | Median ms | p95 ms | Max ms |
| --- | ---: | ---: | ---: |
| Main profile read/apply | 4.85 | 6.49 | 9.45 |
| Stoplist write to observed application | 170.17 | 178.22 | 184.15 |
| Listener replacement/reconnect/confirmation | 11.42 | 15.71 | 74.20 |
| Whole cycle | 190.70 | 211.04 | 252.78 |

## Source ownership checks supporting the interpretation

- `config/model-profile-service.ts` retains a two-slot state map (Main/Utility).
  Saving replaces that slot's current binding and recomputes Utility as needed;
  the subscription set stores listener callbacks, not historical model bindings.
- `config/agent-runtime-config.ts` holds only `current` and one current calibration.
  Each refresh replaces those references. There is no historical-profile map in
  this owner; already admitted Runs retain their own immutable captures.
- `harness/run-service.ts` registers terminal-commit cleanup that deletes the Run
  context from its map and invokes its disposer. Terminal reused admissions dispose
  unused captures. The actual fixture observed empty active Run queues; the public
  measurement does not directly enumerate that internal map.
- `agents/conversation-store.ts` loads/projects replay through its repository on
  demand. Its two diagnostic maps retain per-Character sequence numbers, not all
  history messages. Timeline persistence and transient replay/SDK allocations are
  distinct from a process-wide historical-model cache.
- `server/ws-listener.ts` awaits previous-listener close during replacement, while
  model-profile subscriptions remove their callback on physical connection close.
  The repeated native TCP refusal and fixed live resource counts provide runtime
  evidence for that listener boundary.

These source checks narrow the plausible owners; none alone proves reclamation of
all objects. No production defect was confirmed and no production patch was made.
The driver extension received `node --check` before the successful final cohort.
After space was restored, root also checked the final driver with standalone
`@eslint/js` recommended rules and explicit Node globals: zero errors/warnings.
No ignored-file root-lint result is used as evidence for this research script.

## Delivery storage note

H: reached zero free space during concurrent native work. This completed report
was first written to G: at the integration owner's instruction, then copied back
to this task after space was restored. Evidence and an archival copy of the final
driver are also on G:. The driver's archival copy differs only in line endings.
No caches, unknown files, user data or other worktrees were deleted by this reviewer.
