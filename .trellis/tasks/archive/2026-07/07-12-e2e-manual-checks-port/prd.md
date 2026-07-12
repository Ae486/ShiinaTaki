# PRD — Port manual capability checks to e2e + rebuild capability.trigger

Manual smoke of the M3 capability system still leans on a human driving the CLI + eyeballing results. Most signals (files landing, audit fields, structured errors, reconnect behaviour) are machine-readable; the human-only remainder is a small visual set. This task turns ~13 of the manual checks into a headless regression net on top of the existing `withStack` harness, so future capability work has a safety net BEFORE we touch the timeline/gate internals in the next two tasks. It also fixes two fixture-robustness defects Opus flagged.

## Prerequisite — rebuild the dev-gated `capability.trigger` (L1 driver)

L2 (real LLM) can't deterministically drive governance (cost, non-determinism, the very tool-call hallucination we're chasing). L1 needs a way to make core send a `capability.request` to the node WITHOUT the model. Rebuild the `capability.trigger` WS method that was designed + security-reviewed then rolled back (full recipe: memory `takiagent-dev-capability-trigger-design`).

- **R1 — dev+env double-gated, NOT a gate bypass.** `capability-trigger.ts`: operator-only method, params `z.strictObject({capability, input})`, schema stays in core (never `@taki/shared`, never mirrored in Rust). Handler calls the real capability tool's `execute` (route → broker → **node-side gate still authorizes**); it only removes the LLM. Registered in `main.ts` ONLY when `devTriggerEnabled(env)` (`env.TAKI_DEV_TRIGGER === "1"`, strict), with a loud `warn`. Extract the six Shell-routed capability tools into one `capabilityTools` bag shared by the agent's extraTools AND the trigger (never a separate execute path).
- Unit tests (mirror `capability-respond.test.ts`): unregistered (no env) → METHOD_NOT_FOUND; node role → FORBIDDEN; unknown capability → structured UNSUPPORTED_CAPABILITY.

## Fixture work (extend the harness)

- `withStack` gains a `devTrigger` option that adds `TAKI_DEV_TRIGGER=1` to the core env; `operator-drivers.ts` gains `triggerCapability(socket, capability, input)`; `Stack` exposes an `l1(capability, input)` helper.
- Support seeding node-side config: write `exec-policy.json` into the node's `TAKI_DATA_DIR` before boot (exec allowlist scenarios need it).
- **R-B3** — fold `bootParts` into the try/finally (or give it its own catch-then-cleanup): a boot failure must never leak spawned processes or temp dirs (Opus B3).
- **R-B4** — `killTree`'s POSIX branch only kills the direct child; fix the comment or use a process-group kill so a future Linux port doesn't orphan grandchildren (Opus B4).

## Scenarios to port (≈13, each a new `*.e2e.test.ts` — "add a test = add a file")

Driven by L1 (`allow-once`/`allow-always`/`deny` scripted approver as needed), assert on files/audit/structured results only (R2, no logged content):

- **#5** Always across restart: `allow-always` → screenshot → restart node → screenshot again **without a second gate ask** (persisted `gate-decisions.json`).
- **#6 / #23** deny path degrades: scripted `deny` on screenshot / exec → structured error, no crash, no file.
- **#11** shell-open rejects dangerous schemes (`javascript:`, `file:`) → `unsupported url scheme`, nothing launched.
- **#12** clipboard round-trip (headless node uses real arboard): write then read returns the value.
- **#13** process-list returns pid/name/mem, **asserts no argv field**.
- **#14 / #15** workspace write+read; path-escape (`../../..`) → `OUTSIDE_WORKSPACE`/`INVALID_PATH`, no absolute-path leak.
- **#16** exec allowlist auto-run (`hostname` in allowlist) → runs with **no gate ask**, exitCode 0.
- **#18** chained/redirected command escalates (`git status && del x`) → gate ask even though `git` is allowlisted.
- **#19** catastrophic command (`format c:` / `rm -rf /`) → auto-denied, no dialog, nothing runs.
- **#20** timeout: a long command is killed (~30s) → `timedOut:true`, exitCode null. Mark `slow`.
- **#21** exec cwd is the Workspace.
- **#22** audit records `command` for exec, **absent for non-exec** capabilities.

## L2 real-LLM verification (dual-track — L1 first, then L2)

L1 is the deterministic regression net, but it drives the capability directly and thus **cannot catch model-side failures — the tool-call hallucination we just found is invisible to L1**. Each key capability therefore also gets an L2 scenario driven through the real agent (`agentSay`), so we exercise the thing users actually hit: *does the model actually invoke the tool, or fabricate success?*

- **Order per capability**: write the L1 (deterministic governance) test first, then the L2 (real-LLM end-to-end) test.
- **L2 coverage** (not all 13 — the interaction-heavy ones where hallucination matters): screenshot (already have `screenshot-l2`), exec ("run hostname" → did it really run?), clipboard round-trip, workspace write+read. Each asserts BOTH: (a) `"tool invoked" {capability}` appeared in the core log (the agent really called it) AND (b) the end-to-end result is correct (file/content/exit).
- **L2 is key-gated** (`it.skipIf(!hasKey)`): no provider key → skipped, so **CI stays green regardless**. On a machine with `.env.local`, they run and exercise the real model.
- **Expected-red is expected**: with the timeline still text-only (task 3 not done), some L2 tests WILL fail because the agent hallucinates instead of calling the tool. **Do NOT weaken the assertions to make them pass** — a red L2 here is this net correctly catching the H2/hallucination bug. Tag these clearly (e.g. a `describe("L2 — real agent (may red until agent-tool-timeline)")` block) so they read as the before-baseline for task 3's fix, not as broken tests. The `gates green` DoD refers to the CI gate (key absent → L2 skipped); local L2 reds are a diagnostic signal, not a task-1 blocker.


- **#10 / #17 / #18** dialog text renders the target/command verbatim — visual verification (unit tests already assert the prompt string via the approver).
- **#10** a browser actually opens — real launch is test pollution.
- **#7** Windows Credential Manager entry — the headless node deliberately uses a file secret store; only the Tauri Shell hits the real keyring.

## Constraints
- R2 — metadata/file/audit assertions only; never depend on logged content.
- R3 — B3/B4 fixes must not change existing reconnect/L2 behaviour.
- R4 — exec scenarios seed `exec-policy.json`; catastrophic/timeout run in isolated temp dirs.
- R5 — all gates green (`pnpm -r test`/`typecheck`/lint); the ported e2e pass headlessly on this machine (timeout/slow scenarios may be tagged).

## Out of scope
- **A1** shell-open Always→silent-exec fix → task `shell-open-persist-fix` (next). This net is the thing that will verify that fix.
- **timeline tool parts** + base system prompt → task `agent-tool-timeline` (last).
- **B2** exec argv[0] absolute-path resolution → deferred onto exec auto-run config (#23).
