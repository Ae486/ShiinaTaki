# Delegation interface E2E implementation checks — 2026-11-04

Owner: `validation_implement`. Workspace: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. Exact owned files, final SHA-256 hashes, native binary hash and
revision preimages are recorded in `e2e-files.json`. No production code, provider credentials, user
data, Git delivery or task binding was changed by this owner. All provider calls are root-owned.

## Implemented scope

- Existing scripted inputs now use the flat `handle_agent_event` contract. Canonical action/receipt
  assertions remain unchanged; current delivered teasers validate `eventId` and `kind`, with exact
  work/control targets read from the real detail response.
- The existing scenario runner optionally pairs an exec-only native Node, proves a real allowlisted
  `hostname` despite `exec=deny`, preserves accepted Host/audit/exit evidence, removes its owned
  temporary directory and includes Rust/Cargo/build/binary inputs in source hashes.
- Natural real cases use dedicated opt-in plus the existing real-agent gate, finite deadlines,
  transparent observation/timing and final caps **18/20/32**. No automatic paid retries occur.
- Evidence distinguishes missing private arguments (`null`) from known inputs. Handler intents
  derived from canonical action receipts are explicitly labeled. Missing execution/inspection
  inputs prevent a strict no-wait/no-polling pass. Unknown usage is retained as unknown.
- User Stop keeps the old delayed publication root cancelled. User Continue restores the same
  child work/reporting; a fresh foreground request supplies new authority for its public result.
- Check-in reset is asserted on the immediate authenticated user Continue receipt. Final parent
  approvals equal the actual accepted later parent check-in continuations after that user input;
  a later legitimate parent approval is not mistaken for a failed reset.

## No-model commands and outcomes

Every fixture run cleared inherited `TAKI_E2E_REAL_*` live gates, retaining only the credential-file
path if present. These scenarios use the local scripted provider; this owner issued **zero** paid calls.

```powershell
pnpm --filter @taki/e2e exec vitest run src/agent-interface-native.e2e.test.ts src/agent-interface-inbox.e2e.test.ts src/agent-context-r2.e2e.test.ts src/agent-delegation-checkin.e2e.test.ts src/fixture/real-provider-observer.e2e.test.ts src/fixture/agent-context-timing-relay.e2e.test.ts --maxWorkers=1 --retry=0
```

Initial result: 24 passed, 4 failed, 1 gated skip; 227.61s. Observer/timing and native preflight passed.
Four scripted failures came from a fixture teaser parser requiring omitted `workInputId`. These
failed artifacts remain in `no-model/`; no production projection or canonical assertion was weakened.

```powershell
pnpm --filter @taki/e2e exec vitest run src/agent-interface-native.e2e.test.ts src/agent-interface-inbox.e2e.test.ts src/agent-context-r2.e2e.test.ts src/agent-delegation-checkin.e2e.test.ts --maxWorkers=1 --retry=0
```

Repaired result: **13 passed, 1 gated skip**, exit 0, 60.96s. Evidence: `no-model-repaired/`.
Atomic inbox answering, legitimate later direct answering after `ask_user`, default N50/K3 cases,
R2 controls/publication and native preflight all passed with stable source hashes. Native preflight
recorded zero model requests, successful hostname audit, process exit and removed Node data.

```powershell
pnpm --filter @taki/e2e exec vitest run src/fixture/agent-interface-evidence.e2e.test.ts --maxWorkers=1 --retry=0
```

Result: **1 passed**, exit 0, 2.41s. Omitted native inputs retain only invocation identity; receipt-derived
intent cannot recreate raw model arguments. Unknown exec/extension and inspection inputs fail the strict gate.

```powershell
pnpm --filter @taki/e2e exec vitest run src/agent-interface-checkin.e2e.test.ts --maxWorkers=1 --retry=0
```

First deterministic result failed at step 3 because its callback parsed the compact model wait as a
full canonical wait; `answerInputId` is intentionally omitted. The correction validates only the
actual delivered event/target and `SubagentCheckInSchema`. Failure evidence remains in
`checkin-reset-no-model/checkin-reset-after-user-kHzbVo/`.

Corrected result: **1 passed**, exit 0, 12.12s. Actual SDK/Core/SQLite witnesses reached 11 steps;
check-ins at steps 3/6/9 recorded approvals 0/1/0, the user Continue receipt reset at step 6, and a
legitimate later parent continuation produced final approvals 1. Corrected evidence is a separate
directory under `checkin-reset-no-model/`.

## Final static checks and remaining limits

```powershell
pnpm --filter @taki/e2e typecheck
pnpm exec eslint e2e/src/agent-interface-real.e2e.test.ts e2e/src/agent-interface-checkin.e2e.test.ts
git diff --check -- e2e
```

All exited 0 after the compact-sidecar correction; final typecheck took 7.90s. Earlier scoped lint
also passed all owned TS fixtures/tests after each relevant change. Source is frozen for the root's
corrected real scenario; only these artifact reports were written during that run.

The original root-owned third real run remains failed: 24 actual calls followed by one budget-refused
attempt; its final child event had no accepted main action. Its check-in trace proves the reset and
later legitimate increment but does not prove subsequent handling/public delivery. The new cap 32
does not retroactively change that outcome. Native startup/cleanup double-failure preservation was
independently reviewed, not failure-injected. Real campaign outcomes and owner acceptance remain
the root's separate verification report.

## One additional legitimate user decision — 2026-11-04

The root-owned corrected real run `checkin-corrected/interface-checkin-stop-6UwlHc` remains failed
with 23 successful requests and no budget, cleanup or source-stability failure. At step 9 the parent
legitimately chose `ask_user` under the original one-approval prompt. Its exact check-in stayed open,
the child was quiescent, and the committed `needs_user_input` action/attention were unanswered.
There was no final report. Seven successful reads and two SDK invalid-input rounds contributed the
nine actual completed model steps; the test does not drop those rounds or shrink the source chain.

The approved E2E-only repair permits at most **one additional requested user decision**. A pure
bounded read observes final completion or an exact same-work check-in with committed `needs_user_input`,
an open wait, a quiescent child and no accepted answer. The authenticated Continue occurs outside
the polling predicate and rechecks those facts plus the unchanged completed-step boundary. Each user
receipt proves the exact event/work/user origin and immediate count reset. The historical `ask_user`
action remains immutable; final parent approvals are counted after the latest user input. Another
requested user decision fails explicitly instead of adding an automatic continuation loop.

The original prompt, initial step-3 parent approval, step-6 user Stop and reset, no automatic Stop
notification, seven original source reads, revoked old publication root, final handled event,
fresh foreground publication and no-wait/no-polling gates remain. The real cap remains **32**;
the root separately records its aggregate campaign allowance. No paid calls were issued by this owner.

The existing scripted 11-step regression now covers both `parent_continue` and `ask_user` at step 9.
The first branch correctly ends with one parent approval; the second performs one additional
authenticated user Continue and correctly ends with zero approvals after that latest user input.

```powershell
pnpm --filter @taki/e2e exec vitest run src/agent-interface-checkin.e2e.test.ts --maxWorkers=1 --retry=0
pnpm exec eslint e2e/src/agent-interface-real.e2e.test.ts e2e/src/agent-interface-checkin.e2e.test.ts
pnpm --filter @taki/e2e typecheck
git diff --check -- e2e
```

Focused result: **2 passed**, exit 0, 23.65s. Both branches retained stable source hashes and 11 actual
completed steps. Separate evidence is in `checkin-user-decision-no-model/`. Scoped ESLint, E2E
typecheck and diff-check all exited 0. Revision `.before` files are retained under
`checkin-user-decision-baseline/`; `e2e-files.json` contains refreshed hashes and all prior preimages.
Source is frozen for the root's next paid verification; this report does not turn either failed
real run into acceptance.
