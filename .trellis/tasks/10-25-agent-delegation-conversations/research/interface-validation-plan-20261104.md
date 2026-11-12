# Research: Parent interface validation plan

- Query: How to verify simpler main-agent delegation decisions on the actual configured model, including connected exec availability and exact private inbox acknowledgements?
- Scope: internal, with local installed-version evidence; no new external/provider calls
- Date: 2026-11-04
- Ownership: this research file only. Task comes from the parent dispatch; this child's session resolver has no task. The legacy `.trellis/.current-task` is not authoritative.

Execution update before paid calls: the coordinator retained the aggregate ceiling of 64 but changed the
allocation to 18/20/24 plus two diagnostic requests. The Stop scenario must obtain its final public answer
through a fresh foreground request after the original publication root is revoked. The earlier 20-call
proposal below is research history; `../implement.md` and the campaign JSON own current execution limits.
The recorded follow-up revision after 46 actual requests raises the operational ceiling to 80 for one
corrected check-in rerun (cap 32) plus two reserve requests. After that run reached a legitimate additional
user check-in, the announced ceiling became 103 (69 spent + one cap-32 run + two reserve), with at most
one extra authenticated user decision; see the [acceptance record](interface-acceptance-20261104.md).

## Findings

### Current contract and evidence boundary

The frozen design uses `handle_agent_event({eventId,intent,text,target})`, with intents `record`, `ask_user`, `reply`, `answer_child`, and `continue_child`. Core derives operation identity and the addressed event; the internal six-action union and historical receipts remain unchanged. Ordinary guidance stays on `send_subagent_message`. No yield action is planned. See `../design.md:7` and PRD requirements 15-18.

The November 1 report (`docs/PROMPT-AND-TOOL-REAL-VALIDATION-2026-11-01.md`) records one successful delayed cross-batch answer, an actual `Start-Sleep` proposal refused by `NO_NODE`, and three failed wording probes. Its 68/68 allowance is exhausted historical evidence, not the allowance for this campaign. Fewer inspections never compensate for missing final delivery.

### Files found and reuse

| File and reference | Role / verified pattern |
| --- | --- |
| `e2e/src/prompt-tool-optimization-real.e2e.test.ts:70` | Two real delegated calculations, cap 18, final public answer must contain 45/89/44. |
| Same file, `:86` | Two held real child requests, cap 14; initial acknowledgement, unrelated greeting, first settled idle batch, then second final report and exactly one integrated answer without reminder. |
| `e2e/src/fixture/agent-context-scenario.ts:54` | Configurable real-Core fixture; finite request/session/turn budgets, real or scripted provider, context/check-in tuning. Currently no Host option. |
| Same file, `:132`, `:143`, `:189`, `:246` | New synthetic canonical Local DB; actual `main.ts`; required close/result/source checks; full Core/Shared/E2E TS source hashes. |
| `e2e/src/fixture/pattern-process-entry.ts:1` | Imports production `main.ts`; IPC supplies ready/stop only. It does not invent lifecycle or model facts. |
| `e2e/src/fixture/agent-context-timing-relay.ts:26` | Transparent hold/release before real upstream forwarding, identical bytes/streams, body hashes and physical-forward/cancellation timestamps. |
| `e2e/src/fixture/real-provider-observer.ts:54` | Synchronous synthetic capture before HTTP, conservative finite request reservations, allow-listed non-content diagnostics. |
| `e2e/src/fixture/node-process.ts:23`, `with-stack.ts:155` | Existing paired native `taki-node` process; isolated Node state, scripted approval, accepted connection. `withStack` checks binary existence even with `startNode:false`. |
| `e2e/src/fixture/paths.ts:15`, `:28` | Exact debug binary location and file-only provider loading. Direct provider environment variables alone do not enable this fixture. |
| `e2e/src/approval-challenge-resume.e2e.test.ts:143`, `:169` | Scripted paired Host/catalog precedent; deliberately legacy challenge refusal, not successful exec or current governance implementation. |
| `e2e/src/agent-delegation-goals-real.e2e.test.ts:53`, `:85`, `:211` | Natural running correction; exact missing-latency question/answer; long audit/compaction/check-in. Existing caps 32/40/224 must not be accidentally run as this smaller campaign. |
| `e2e/src/agent-delegation-checkin.e2e.test.ts:11` | Scripted HTTP plus production Core/WS, default N=50/K=3 and 36/50/56 steps; useful no-paid regression. |
| `e2e/src/fixture/agent-context-r2.ts:50` | Authenticated parent cancel, child user Stop, parent refusal, user Continue and distinct publication evidence. Existing real prompts dictate tools; retain as control evidence, not natural interface-choice proof. |
| `e2e/src/fixture/agent-context-inbox.ts:28`, `:71` | Scripted provider helper currently emits old nested model inputs; durable action joins/assertions intentionally read the unchanged canonical union. |

### Smallest valid execution fixture

Prefer adapting **the existing observed `withAgentContextScenario`**, retaining its request budget and exact evidence, and composing `startNodeProcess` into its test-only lifecycle. Plain `withStack({provider:'real'})` has no transparent observer/request cap and therefore is insufficient by itself for this campaign.

Concrete fixture edits for the E2E owner:

1. Add a test-only optional native Host option to `ScenarioInput`, handled inside `runScenario` while the `core` process is available. Reuse `NodeProcessParts`, `startNodeProcess`, `killTree`, and `seedNodeState`; create one isolated temporary Node directory before spawn. Keep the existing provider observer and optional timing relay untouched.
2. After operator authentication and before the first `ask`, start the native Node with capabilities restricted to `exec`. Feed the pairing code from the owned Core's `pairing code issued` log using the unique Node device name, as `withStack` already does. Loopback auto-trust is operator-only; a Node still pairs (`server/methods/connect.ts:94`). Await native `state=connected`, then require accepted ready Host/catalog state through the public operator APIs.
3. Seed `exec-policy.json` with `mode:'allowlist'`, `allowlist:['hostname']`, and an isolated cwd. Use the existing relaxed Core permission setting and Node `autoApprove:'exec=deny'`: simple allowlisted `hostname` can execute; escalated shell/sleep proposals are denied. Existing Rust policy always escalates shell interpreters (`capabilities_impl/exec/policy.rs:19`). Any wait-only proposal is a failing behavioral observation even if governance prevents execution. Do not manufacture a success result or silently omit the attempted command.
4. First verify one deterministic real `hostname` effect/audit result without a provider call, then make the campaign's unrelated foreground task request the same harmless action naturally. This distinguishes genuinely usable native exec from a catalog that only advertises it. Restricting exec protects fixture scope; it does not prove arbitrary native commands or approval UI usability.
5. Extend required `finally`/deadline cleanup to kill and await the owned Node, close every independent socket/relay, preserve synthetic audit evidence, and remove only the resolved fixture Node temporary directory. Failed Host startup must spend zero provider requests and still tear down Core/observer/relay.
6. Update `scriptedInboxReply` to translate its scripted canonical actions into the new flat input. Keep `assertHandledEvent` and canonical `action_json` parsing unchanged. Do not use this scripted helper to dictate answers in real-provider scenarios. Natural scenarios can use complete previews directly; forced helper detail reads are not efficiency evidence.

No ready reusable successful current-governance scripted exec Host was found. The legacy paired-Host test is not one. If native setup is blocked, a new test-only scripted Host would need real pairing/catalog/current governance and a structured outcome, with a local deterministic proof before paid use. Label it **real model + production Core + scripted Host, no OS execution**; connected native behavior remains unpassed. Avoid adding a production transport hook or Host policy bypass.

### Proposed fresh request allowance and scenarios

Recommend a **new aggregate ceiling of 64 upstream requests**: three explicit scenario caps totaling 58, plus at most six for one evidence-justified focused diagnostic. No automatic retry, full-suite rerun, utility bypass, or reuse of the historical allowance. A retry or compaction/utility request consumes the same cap. The diagnostic reserve requires an explicit finite observer and its own fresh evidence directory; it is not a top-up after failure.

| Scenario / cap | Required real observation and current gap |
| --- | --- |
| Connected delayed two-report + useful foreground work / 18 | Adapt `prompt-delegation-delayed`: both actual child requests held, initial parent reply finishes, ordinary chat and real allowlisted foreground exec finish while children remain held. Release A, settle its idle handler, then release B. Exactly one final 45/89/44 public answer without a reminder; durable two actions and publication receipt. Fail any wait-only exec proposal or repeated identical completion polling. Purposeful cross-batch result lookup is allowed. This adds the missing usable-Host condition. |
| Running guidance + exact question / 20 | Adapt the natural correction and missing-latency examples into one small decision task. Hold the child, send ordinary offline/preservation guidance while its Run/control version changes; same work receives it without extra child creation. Ordinary guidance does not resolve a question. After a genuine question is delivered, the main knows a separate user-supplied latency value and uses `answer_child` through the bound inbox; one action and addressed input commit atomically, same work resumes in a new Run, final recommendation is genuine. Do not pass because a direct send resolved the wait while the delivered event remained unhandled. |
| Short factual check-in + user Stop / 20 | Use a small serial evidence chain with test-only N=3/K=1, avoiding the existing 224-request audit. Observe an actual completed-step check-in, parent `continue_child` once, second check-in requires user; old/new interval and approval counts remain exact. Stop via authenticated user WS, then ordinary parent guidance cannot clear the latch or start work. Explicit user Continue resumes the same work and reporting counterpart. Capture whichever path actually occurs; absence of a required boundary is an unmet scenario, not success. |

Natural prompts specify work/outcomes, never tool names, argument shapes, event IDs or receipt keys. Fixture timing, authenticated user controls and deterministic state assertions can use exact IDs. Session bounds remain finite (suggest 420s/540s/600s with existing 180s turn/HTTP bounds); waiting does not extend them. N=3/K=1 is a declared test configuration, not a product-default change. Full N=50/K=3, compaction, retry races and injected SQL failures remain deterministic regressions; this small campaign is not long-audit reacceptance.

Keep action ownership reachable: `answer_child`/`continue_child` acceptance needs an unhandled event in the current immutable delivered batch. If the handler already committed `ask_user`, a later user answer deliberately uses the normal exact-message/Continue route; it cannot replace the immutable old action. Test both cases explicitly, and do not call that legitimate later direct answer an interface failure. For the atomic inbox-answer observation, seed a missing child requirement whose authoritative value is already available to the main conversation, or deliver trusted guidance before the question's first disposition; verify the actual trace rather than assuming the event stayed unhandled.

Review every actual main tool call by unique `tool_call_id`, category and semantic purpose. Separate ordinary messages, exact inbox answers/continuations, purposeful cross-batch reads, diagnostics, identical polling and wait-only commands. Record initial response and foreground-task durations; a quick denied sleep still fails the no-wait-attempt criterion. Do not require zero inspections. Structural counters and successful tool inputs do not establish semantic correctness or measured causal savings.

### Commands and credential handling

Checked locally: Node `v24.18.0`, pnpm `10.22.0`. Declared installed stack is `ai@7.0.148`, compatible adapter `3.0.75`, MCP `2.0.81`; resolve installed package versions before reporting them as runtime facts. No provider credentials were read or printed by this research.

Use an existing ignored `.env.local`, or set `TAKI_E2E_REAL_ENV_FILE` to an already prepared owner-controlled env file. `paths.ts` reads only `TAKI_PROVIDER_BASE_URL`, `TAKI_PROVIDER_API_KEY`, `TAKI_PROVIDER_MODEL`; scenario tuning may additionally read `TAKI_PROVIDER_CONTEXT_TOKENS`. Do not `Get-Content` the secret file, print provider objects/environment, put credentials in commands, or copy them into evidence. This is the existing test credential loader; production keyring/catalog rules remain unchanged. Use presence-only checks when diagnosing a missing key.

Before paid execution, disable all live gates for deterministic checks and use a fresh artifact root:

```powershell
Remove-Item Env:TAKI_E2E_REAL_AGENT_CONTEXT -ErrorAction SilentlyContinue
Remove-Item Env:TAKI_E2E_REAL_PROMPT_TOOLS -ErrorAction SilentlyContinue
Remove-Item Env:TAKI_E2E_REAL_DELEGATION_TIMING -ErrorAction SilentlyContinue
Remove-Item Env:TAKI_E2E_REAL_AGENT_DELEGATION_GOALS -ErrorAction SilentlyContinue
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/e2e typecheck
pnpm --filter @taki/core exec vitest run src/agents/subagent-model-output.test.ts src/harness/subagent-followup-contracts.test.ts src/harness/subagent-interactive.test.ts src/harness/subagent-checkin.test.ts src/db/subagent-inbox.test.ts src/harness/subagent-inbox-yield.test.ts src/agents/chat-agent-inbox.test.ts src/agents/chat-agent-inbox-lazy.test.ts src/server/methods/subagent-methods.test.ts --maxWorkers=1 --retry=0
pnpm --filter @taki/e2e exec vitest run src/fixture/real-provider-observer.e2e.test.ts src/fixture/agent-context-timing-relay.e2e.test.ts src/agent-context-r2.e2e.test.ts src/agent-delegation-checkin.e2e.test.ts --maxWorkers=1 --retry=0
```

Add flat-schema tests at the existing Shared schema/SDK test owners, equivalent retries with different call IDs, conflicting intents and historical receipt reuse, rollback of answer/action and check-in/action, wrong-event/work/Character, stale exact controls, user Stop and mixed public/private effects. Run applicable workspace lint and required checks once after final changes. Extra native L1 preflight must omit the screenshot used by `exec-audit-command.e2e.test.ts`; this is an exec/delegation campaign.

The exact **existing** delayed test entrypoint is:

```powershell
$env:TAKI_E2E_REAL_AGENT_CONTEXT = '1'
$env:TAKI_E2E_REAL_PROMPT_TOOLS = '1'
$env:TAKI_E2E_REAL_DELEGATION_TIMING = '1'
$env:TAKI_E2E_EVIDENCE_DIR = 'H:/TakiAgent-worktrees/t4/artifacts/delegation-interface-real-20261104'
pnpm --filter @taki/e2e exec vitest run src/prompt-tool-optimization-real.e2e.test.ts --testNamePattern 'delayed delegated reports' --maxWorkers=1 --retry=0
```

This currently runs cap 14 with **no Host**; call it the native scenario only after the fixture edits above. The proposed cap 18 is a source change, not an existing env override. Adapted question/check-in cases should get precise unique test names and the same explicit real opt-ins; execute them separately with exact `--testNamePattern` and fixed caps 20/20. Do not select the whole goals file: its 224-request case is outside this allowance. Clear the live opt-ins before subsequent deterministic commands. No new paid entrypoint is implemented in this report.

### Source, accounting and cleanup evidence

- Existing artifacts: `<TAKI_E2E_EVIDENCE_DIR>/<scenario>-<unique>/baseline.json`, `effective-settings.json`, `request-N.json`, `phase-N.json`, `result.json`; `transport.json` when timing is used. Synthetic `data/taki.db` is retained deliberately for evidence. Existing real scenario cleanup closes owned processes/sockets; it does not delete this retained data directory.
- Baseline/final manifests hash Core/Shared/E2E TS and package/lock/config inputs (`agent-context-scenario.ts:246`). Add native binary SHA-256 plus relevant Rust sources/Cargo manifests/lock for a native claim; the current manifest omits them. Freeze mutations to covered sources for each paid run. Capture source stability and required evidence write success even when the exercise passes.
- Count separately: observer attempts, admitted observer reservations (`upstreamAttempted`), timing-relay physical forwards (`forwardedAt`), completed HTTP responses, admitted/settled model Effects, actual completed generations, child task-step witnesses, utility Effects and usage completeness. Held-and-cancelled requests spend conservative observer allowance but are not physical upstream model attempts. Concurrent `effectsAtRequest` are candidate observations, not exact request/Effect correlation.
- Require original question/check-in event, work, consumer Run/Attempt/model Effect, canonical action/result receipt, accepted input/consumption and successor Run. Join with `handledEvents`; retain historical IDs/digests internally without displaying them as ordinary model parameters. Missing usage remains unknown, never zero. Model route and provider-reported model labels are separate facts; no billing estimate.
- For a native Host, retain synthetic exec audit and accepted catalog/generation plus process-exit evidence; remove the fixture's resolved Node temp directory after shutdown. Retained artifact DB/requests are synthetic only. Cleanup failure, capture failure, source drift, refused request budget or omitted final delivery fails the campaign.

### Related specs and external references

- `.trellis/spec/backend/e2e-harness.md`: real vs scripted boundaries, transparent observer/timing, explicit opt-in, teardown and physical request counting.
- `.trellis/spec/backend/private-agent-inbox.md:27`, `:80`: immutable batches, accepted/delivered/handled distinction, atomic addressed actions, ordinary drift tolerance and user Stop.
- `.trellis/spec/backend/private-worker-checkin.md`: actual step witness, N/K, exact continuation/authority and unknown usage.
- `.trellis/spec/backend/tool-design.md:100`, `:159`: inspect actual SDK object-root schema, actionable refusals, preserve useful functional selectors and raw canonical results.
- `.trellis/spec/backend/native-image-input.md`: single primary text/image route, inert VLM config, real serializer and independent visual acceptance.
- External reference already cited by current tool spec: <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>. No fresh external documentation retrieval was necessary; claims here are limited to current local source/package evidence.

## Caveats / Not Found

- No tests, new provider calls, service startup, real-user DB reads/mutations, Git operations or code changes were performed by this researcher. Native fixture boot and actual exec success remain unverified here.
- Current native-image bootstrap creates only the primary model (`boot/core-bootstrap.ts:97`, `config/provider-factory.ts:13`); retired partial VLM settings are inert (`core-bootstrap.test.ts:47`). The text-only synthetic campaign should not require VLM setup or an image service. Main now wires retained attachments into both chat and child context (`main.ts:238`, `:515`, `:645`); do not revive removed translators or override production wiring merely to boot a test.
- The existing debug `taki-node.exe` exists, size 9,364,480 bytes, last-write October 30, before the November 2 native-image contract. This is availability evidence only. Build current native sources with `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin taki-node --locked` before native acceptance, or document the exact binary/source relation. No native rebuild was performed here.
- Run bootstrap/native-image/provider-config regressions before the E2E boot preflight when affected source changes remain: `src/boot/core-bootstrap.test.ts`, `src/agents/native-image-wire.test.ts`, `src/agents/private-native-images.test.ts`, `src/config/provider-factory.test.ts`. Package resolution, current Rust toolchain and real Host boot still require local verification; declaration/binary presence does not establish them.
- Single successful samples establish the observed cases. Broad reliability, default-long-work live compaction, arbitrary OS execution, native UI/permission dialogs, owner acceptance, Hindsight and T4/main data convergence remain separate gates.
