# Integrated acceptance design

Status: acceptance preparation; real-model E2E is explicitly owner-authorized as of 2026-10-22. Full integrated trials follow the Runtime/source implementation gates.

## Test layers

| Layer | Establishes | Does not establish |
| --- | --- | --- |
| Deterministic Core/protocol/UI tests | Source identity, roles, serialization, ordering, deduplication, stop scope, correct controls | General model understanding or owner acceptance |
| Captured actual model requests | What the model and compactor receive through real Taki paths | That the model will always use it correctly |
| Controlled authorized live model trials | Observed source/self-report interpretation with recorded model/settings | Universal reliability or owner UX approval |
| Owner trials | Requested child UI and Co-Watching experience | Untested recovery/provider guarantees |

## Scenario matrix

- Video speaker says "my project failed": later Companion discussion must not invent a user's failed project.
- User explicitly says their own project failed, including while a video is active: preserve the user's report.
- Mixed external quotation and user comparison: keep both sources and uncertain claims distinct.
- Parent selectively delegates and later corrects material: child receives addressed updates and latest valid revision, not unrelated parent chat.
- Parent stops while multiple children work: all children continue, with record-only versus parent-continuation outcomes separately observed.
- User stops one child: context stays visible, parent messages cannot restart it, explicit user continuation can admit later work.
- Publication then compaction/restart: durable source evidence projects correctly; terminal Runs never restart and uncertain side effects are not repeated.
- Relevant memory admission/use: preserve source meaning within existing eligibility; missing provider evidence remains unverified.
- Foreground conversation, playback pause/stop and source retirement: preserve existing presentation/delivery gates and record outstanding manual checks.

## Evidence records

For each scenario record fixture/source, exact build/package set, input/request excerpt or safe artifact reference, expected distinction, observed output, test layer and disposition. Protect credentials and user data. Use isolated disposable data for controlled trials, including test-owned Memory reads/writes needed to verify the main/child boundary. Real-user Memory mutation remains outside the authorized test scope. Evidence files belong under this child after execution, with links from the parent.

The supported model route has passed one isolated connectivity/baseline scenario; see [live E2E preparation](research/live-e2e-preparation.md). Reuse its credential-loading/isolation pattern and retain configured versus provider-reported model IDs separately. This baseline is not a completed delegation or source-semantic trial.

## Failure handling

Source loss is a deterministic defect even if a model guessed correctly. A semantic misattribution with intact inputs requires prompt/representation review and a regression scenario. A UI/control issue returns to the owning child. Do not mask one layer's failure with another layer's success.
