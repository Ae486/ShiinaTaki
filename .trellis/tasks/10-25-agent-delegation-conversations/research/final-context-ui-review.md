# Independent final context and Desktop review

Reviewer: `context_ui_review`. Date: 2026-10-25. Independent review is complete; the coordinator owns correction verification and native acceptance.

## Authority and scope

Read the original PRD, design, implementation plan, October 24 owner direction in `docs/AGENT-DELEGATION-RESEARCH.md`, `AGENTS.md`, `CLAUDE.md`, current context/Desktop/root checkpoints, and the private-worker, inbox and frontend read-model contracts. Verified worktree `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`; the explicit task assignment supersedes the missing/stale global pointer. The inherited dirty baseline remains intact (1,066 porcelain entries at the review checkpoint).

Read-only review except this owned report. No source/test/dependency edits, paid calls, real-user data, Git delivery, migration or other-worktree action. Temporary production line-count overruns were explicitly permitted and produce no size-only findings. The code-review-excellence skill supplied the evidence-first review method; its general size suggestions do not override owner direction.

Runtime lifecycle, publication and migration are reviewed independently by `runtime_review`. Native production Core/WebView2 verification belongs to the coordinator and was still running at this review checkpoint.

## Confirmed required correction: swallowed checkpoint failure

**P1: a failed durable step checkpoint can silently omit a completed tool observation and still end as validated completion.**

Locations in the reviewed source:

- `packages/core/src/agents/agent-attempt.ts:123` registers `onStepEnd`; lines 133-140 capture public recording, private inbox recording, raw tool materials and private work messages without a retained failure latch.
- `packages/core/src/agents/agent-attempt.ts:93` prepares the next child request from the durable work context, and its checkpoint/rollover branch can proceed independently of an earlier callback exception.
- `packages/core/src/agents/run-message-store.ts:103` reconstructs the prepared request from private repositories.
- Installed `packages/core/node_modules/ai/src/util/notify.ts` catches callback exceptions. `stream-text.ts:1762` calls this helper for `onStepEnd`.

This is not an inferred SDK behavior: the following native Node / actual ChatAgent / actual SQLite probe executed a real local tool, induced one raw-message INSERT failure, and observed a second task-model request followed by validated completion. Its second prompt lacked the already completed tool observation. Raw material storage survived, but ordinary task reasoning did not receive that observation and no execution failure was reported.

Environment: Node `v24.18.0`, pnpm `10.22.0`, installed AI SDK `7.0.148`. Run the following through `node --input-type=module` from this worktree (PowerShell here-string stdin; no test/source files are changed):

```js
import { subagentFixture } from './packages/core/src/testing/subagent-fixture.ts';
import { scriptedModel } from './packages/core/src/testing/mock-language-model.ts';
import { tool } from './packages/core/node_modules/ai/dist/index.js';
import { z } from './packages/shared/node_modules/zod/index.js';

const model = scriptedModel([
  { kind: 'tool', toolCallId: 'probe', toolName: 'probe', input: {} },
  { kind: 'tool', toolCallId: 'done', toolName: 'complete_subagent',
    input: { text: 'Reported success', materials: [] } },
]);
const f = await subagentFixture(model, { tools: {
  probe: tool({ inputSchema: z.object({}),
    execute: () => ({ result: 'EXACT_COMPLETED_PROBE_EVIDENCE' }) }),
} });
try {
  f.queue.tryAcquireBackground('taki');
  f.db.exec("CREATE TRIGGER review_fail_output BEFORE INSERT ON run_messages "
    + "WHEN NEW.entry_kind='output' AND NEW.step_number=0 "
    + "BEGIN SELECT RAISE(ABORT,'review induced raw checkpoint failure'); END");
  const accepted = await f.service.delegate({
    parentRunId: f.parent.run.runId, parentToolNames: ['probe'],
  }, {
    characterId: 'taki', operationKey: 'review-checkpoint', label: 'Review worker',
    initialContext: { kind: 'fresh' }, direction: 'Probe once and report',
    materials: [], completionPolicy: 'record_only',
  });
  for (let i = 0; i < 100
    && !f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const execution = f.executions.list({ subagentId: accepted.conversation.subagentId })[0];
  console.log(JSON.stringify({
    calls: model.doStreamCalls.length,
    outcome: execution?.result?.outcome,
    outputKind: execution?.result?.outputKind,
    secondRequestHasObservation: JSON.stringify(model.doStreamCalls[1]?.prompt)
      .includes('EXACT_COMPLETED_PROBE_EVIDENCE'),
    messages: f.messages.history({ subagentId: accepted.conversation.subagentId })
      .map(row => ({ step: row.stepNumber, kind: row.entryKind, role: row.role })),
    errors: f.errors,
  }));
} finally {
  await f.close();
}
```

Observed pre-correction output:

```json
{"calls":2,"outcome":"completed","outputKind":"validated","secondRequestHasObservation":false,"messages":[{"step":0,"kind":"input","role":"user"},{"step":1,"kind":"input","role":"user"},{"step":1,"kind":"output","role":"assistant"},{"step":1,"kind":"output","role":"tool"}],"errors":[]}
```

Required behavior: retain the callback failure, stop before another model intent or SDK checkpoint/release, and settle with truthful unfinished/failure evidence. A callback failure must not cause automatic tool replay. The correction owner is `worker_context`; root was informed immediately. Final correction verification is pending.

## Candidate: late visibility behind a forward cursor

`db/subagent-conversation-repo.ts:55,70,94` withholds active output/event entries until presentation sidecars exist, while later accepted-input references remain visible. `features/subagents/subagent-conversation-pages.ts:48-60` refreshes newest rows and advances only above the last cached sequence. If a withheld row becomes visible below that tail and outside the newest page, the cache never rereads it.

An actual `SubagentConversationPages` native Node probe with a minimal query adapter demonstrates the read-side hole:

1. Initially visible sequence `[1]`; read and exhaust older history.
2. Sequence 2 is withheld; visible `[1, 3, ..., 53]`; refresh newest plus forward pages.
3. Sequence 2 becomes visible; refresh newest (limit 50).
4. Result remains 52 entries, sequence 2 absent, `hasMore=false`, `nextCursor=null`.

Core query semantics match this adapter. Production scheduling reachability of enough later visible entries within the actual `onStepEnd`/public `finish-step` gap remains under independent investigation with `runtime_review`. The installed SDK forwards `finish-step` before processing `onStepEnd`, so no invented ordering guarantee is assumed; however a synthetic sequence adapter alone does not prove a production bug. This candidate is not yet classified as a required correction.

## Confirmed required correction: unbounded prior live snapshots

**P2: repeated normal long-result Runs retain unbounded additional live snapshots, contrary to the explicit bounded private-activity requirement.**

`use-subagent-activity.ts:65-70` removes a retained prior Run only when every observed item has complete loaded canonical batch coverage. `db/subagent-conversation-repo.ts:133` previews entries over 12,000 bytes; `completePrivateItem` correctly refuses that preview as full replacement. There is no automatic body recovery or cross-Run count/byte budget in this adapter. These are additional live snapshots, not intentionally retained user-requested conversation pages.

Actual reproduction used six same-child explicit continuations. Each real ChatAgent/SDK Run produced a roughly 21.6 KB text result. Actual `service.activityRead` terminal snapshots and actual `service.conversation` preview pages were passed to the exact source `rememberPrivateActivity` function, transpiled standalone to avoid requiring a React host. The reducer was not rewritten and producer snapshots were not fabricated. No manual older/body loading occurred.

| Completed Runs | Retained snapshots | Prior snapshots exposed | Retained snapshot JSON bytes | Durable preview rows |
| --- | --- | --- | --- | --- |
| 1 | 1 | 0 | 22,522 | 2 |
| 2 | 2 | 1 | 45,044 | 4 |
| 3 | 3 | 2 | 67,566 | 6 |
| 4 | 4 | 3 | 90,088 | 8 |
| 5 | 5 | 4 | 112,610 | 10 |
| 6 | 6 | 5 | 135,132 | 12 |

All snapshots were terminal, all producer executions settled, and fixture errors were empty. Serialized byte counts are a reproducible retained-data measure, not a JS heap allocation claim. Core's per-snapshot 512-item / 1-MiB cap does not bound the cross-Run Desktop map.

Smallest repair direction: demand-driven, serialized bounded hydration of the canonical batches needed by obsolete observed snapshots, merge complete bodies into the existing canonical read cache, then retire only fully covered live references. Recovery failure remains visible and retryable and must not silently discard observed output. Bound recovery work per pass; an arbitrary count-based eviction alone would violate the retained-output requirement. The coordinator is assigning Desktop correction after this reviewer releases its slot.

Reproduction command body for `node --input-type=module` from the worktree:

```js
import fs from 'node:fs';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { subagentFixture } from './packages/core/src/testing/subagent-fixture.ts';
import { scriptedModel } from './packages/core/src/testing/mock-language-model.ts';
const source = fs.readFileSync('./apps/desktop/src/features/subagents/use-subagent-activity.ts', 'utf8');
const body = source.slice(source.indexOf('export function rememberPrivateActivity'));
const helper = ts.transpileModule(body, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText;
const imports = `import { activityItemKey } from '${pathToFileURL(process.cwd()
  + '/apps/desktop/src/lib/chat-activity-state.ts')}';\n`
  + `import { completePrivateItem } from '${pathToFileURL(process.cwd()
    + '/apps/desktop/src/features/subagents/subagent-live-coverage.ts')}';\n`;
const { rememberPrivateActivity } = await import('data:text/javascript;base64,'
  + Buffer.from(imports + helper).toString('base64'));
const count = 6;
const text = 'Full observed private worker result. '.repeat(600);
const model = scriptedModel(Array.from({ length: count }, (_, i) => ({
  kind: 'text', deltas: [`Run ${i + 1}: ` + text],
})));
const f = await subagentFixture(model, {
  agent: { contextWindowTokens: () => 200000 }, historyBudget: () => 180000,
});
const retained = new Map();
const samples = [];
try {
  f.queue.tryAcquireBackground('taki');
  const accepted = await f.service.delegate({
    parentRunId: f.parent.run.runId, parentToolNames: [],
  }, {
    characterId: 'taki', operationKey: 'review-live', label: 'Live review',
    initialContext: { kind: 'fresh' }, direction: 'Produce result', materials: [],
    completionPolicy: 'record_only',
  });
  const child = accepted.conversation.subagentId;
  for (let n = 1; n <= count; n++) {
    for (let i = 0; i < 200; i++) {
      const runs = f.executions.list({ subagentId: child });
      const activity = f.service.activityRead({ characterId: 'taki', subagentId: child });
      if (runs.length === n && runs.every(run => run.result)
        && activity.activity.status === 'terminal') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const metadata = f.service.activityRead({ characterId: 'taki', subagentId: child });
    const page = f.service.conversation({
      characterId: 'taki', subagentId: child, direction: 'newest', limit: 100,
    });
    const view = rememberPrivateActivity(retained, {
      metadata, view: { snapshot: metadata.activity, stale: false },
    }, { entries: page.entries, tailSeq: page.entries.at(-1)?.seq ?? 0 });
    samples.push({
      runs: n, retainedSnapshots: retained.size, priorSnapshots: view.retained.length,
      retainedJsonBytes: [...retained.values()].reduce((sum, value) =>
        sum + Buffer.byteLength(JSON.stringify(value.view.snapshot)), 0),
      durablePreviewRows: page.entries.filter(entry => entry.body).length,
      activityStatus: metadata.activity.status,
    });
    if (n < count) {
      const current = f.service.summary(child);
      f.service.continue({
        characterId: 'taki', target: { subagentId: child,
          workInputId: accepted.input.workInputId, expectedRunId: current.activeRunId,
          expectedControlVersion: current.controlVersion },
        operationKey: 'review-next-' + n, direction: 'Produce another result', materials: [],
      }, { kind: 'user' });
    }
  }
  console.log(JSON.stringify({ samples, errors: f.errors }));
} finally {
  await f.close();
}
```

## Other reviewed contracts

- Child-only `isLoopFinished` plus pressure rollover uses the same live Run/Attempt; SDK local steps become monotonic global ordinals. Primary and parent-handler caps remain separate.
- Work preparation captures the full pending watermark. Actual model intent requires every pending input through it; later inputs stay pending. Raw input inclusion receipts, immutable first consumption and summary witnesses are distinct.
- Summary preparation measures fixed instructions/tools plus messages, preserves paired rounds, labels historical terminal partial/input-only evidence, and retains live incomplete/unknown protection. Source digest includes canonical outcome/sender/content; transactional commit rechecks revision, current owner, stop and source.
- Summary failure/non-shrinking fallback is explicit, retains raw evidence and refuses an unfit request. Giant output projections include self-history cursors; fixed unfit input is refused. Local settled error frontiers are distinct from provider/deferred/approval/unresolved frontiers.
- Self-history reads are intrinsically available and child-scoped, distinguish read states, expose all categories/body pages, freeze numeric traversal watermarks and preserve surrogate pairs.
- Raw materials persist before cache release. Recording/material/tool-observer references release at a drained SDK segment; activated disclosure names survive without loader replay. The checkpoint-failure finding above is the exception to the intended persistence gate.
- Foreground inbox tools register eagerly; only the first nonempty batch is lazily claimed at `prepareStep`. Private tool pairs are split from public recording/activity, full current SDK history remains available, and public source attribution is attached only after actual inbox intent.
- The child page uses shared `TimelineView`, message/tool/Markdown presentation and `ConversationComposer`, with a separate private controller. Work selection addresses controls without filtering the continuous transcript.
- Sender/source labels, exact captured draft targets, edit revisions, explicit unknown-outcome confirmation, no automatic mutation replay and one-RPC Send-and-continue are wired. Accepted echoes are scoped to the selected child.
- Core supplies conversation ordering, native item identities and complete batch membership; Desktop does not retire live material on a first row or covered-step watermark alone. Long-body reads are digest-fenced and preserve fully loaded content across refresh.
- Selected child invalidations refresh detail; other children refresh only the list. Child activity and main Chat have independent subscriptions and recovery. Parent inbox recovery is an explicit independent control, not a read-triggered execution.

## Files reviewed and evidence boundary

Actual source inspected: `agents/agent-attempt.ts`, `worker-sdk-segment.ts`, `private-task-context.ts`, `run-message-store.ts`, `private-task-summarizer.ts`, `subagent-self-history-tool.ts`, `foreground-inbox.ts`, `turn-recording.ts`, `tool-disclosure.ts`, `run-observability-telemetry.ts`; `db/subagent-context-summary-repo.ts`, `run-message-repo.ts`, `subagent-conversation-repo.ts`; `harness/subagent-tool-materials.ts`, `subagent-activity.ts`, `subagent-inbox-context.ts`, relevant `subagent-execution.ts`; Desktop `subagent-controller.ts`, `subagent-conversation-pages.ts`, `subagent-drafts.ts`, `subagent-conversation-transcript.ts`, `subagent-live-coverage.ts`, `use-subagent-activity.ts`, `subagent-message-projection.ts`, `subagent-composer.tsx`, `subagent-detail.tsx`, `subagent-inbox-controller.ts`; relevant existing regression tests and installed SDK callback/stream implementation.

The reviewer ran the native fixture smoke and the read/checkpoint/retained-live probes above. Reported Desktop 1,251 tests, controller 13 tests, context 27/63 tests and forced-GC evidence were reviewed as prior worker evidence, not rerun or relabelled as this reviewer's executions. Native UI, real-model semantic summary fidelity, owner visual/IME acceptance, native Hindsight and T4/main convergence remain distinct coordinator/external gates.

Final review disposition: request the two confirmed corrections above. The hidden-sequence candidate remains an evidence gap, not a third confirmed defect. No other independently verified blocker was found in this assigned context/UI scope. This does not claim correction acceptance; root must verify the actual fixes and their preserved behavior.
