# Live configuration application

## 1. Scope / Trigger

Applies to Core configuration consumers, model admission, Local/Legacy search policy, listener replacement and
Desktop projections. Basic services start without Main or valid optional feature policy; storage/authority corruption
still refuses startup. Hindsight internal connection, Bank, synchronization, recovery and write logic belongs to its
dedicated task. This contract does not authorize replacing those owners.

## 2. Signatures

- `ConfigEntry.application` / `ConfigSetResult.application`: optional `{boundary, state, activeValue, message?}`.
  Boundaries distinguish immediate, next Run/operation, component, maintenance, external, bootstrap and inapplicable.
  States distinguish applied, applying, draft, failed, unavailable, external, inapplicable and restart-required.
- `createConfigApplication(...).apply(keys, operation)` observes sync/async settlement with revision fencing.
- `config.modelProfiles`, `config.modelProfileSave`, `config.modelProfileTest` and their subscription own
  Main/Utility drafts, revisions, apply/test/disable/reset and secret references. Migrations
  070/071 persist profiles and staged secret ownership; incomplete drafts do not replace active profiles.
- `MemoryEngine.searchStatus()` exposes committed policy; `reconfigureSearch` builds a candidate;
  `reconfigureRanking` alone replaces Legacy BM25 queries.
- Migration 072: `search_projection_policy(index_name, authority_epoch_id, tokenizer_version, stoplist)`.
  Version includes implementation revision and ICU/Unicode versions.
- Existing Memory owner admits `{kind: "index.rebuild", stoplist}` and records actual terminal settlement.

## 3. Contracts

- Precedence is application > environment fallback > default. Data root is a pre-storage exception. Disable/no-auth
  is explicit ownership; reset removes ownership. Credentials never enter scalar rows.
- `apply: live` means a runtime consumer exists, not immediate completion or provider validation. Render the actual
  application observation. Canonical BM25 is inapplicable; selected Hindsight internal search/retention/connection
  replacements remain reserved. External settings do not imply remote deployment.
- Capture model/key, limits, prompt, calibration and usage identity once per admitted Run. The next message in the
  same conversation captures new policy; queued work/retries retain their original capture.
- Utility retains one queue and captures model/policy before queueing. Invalid Utility context does not disable Main;
  invalid Main policy does not prevent Utility-context or maintenance-only updates.
- Local/Legacy assembly, search, ranking, retention and Tidy availability are independent. Invalid initial policy
  remains unavailable; construction defaults never authorize dependent model/destructive work. Failed later candidates
  preserve accepted policy. Tidy admission failures remain rejected Promises.
- Unknown projection policy blocks dependent capture, writes and Tidy model dispatch until bounded asynchronous
  reconstruction succeeds. Known previous policy keeps queries/writes coherent during preparation. Source dirty keys
  reconcile concurrent writes. FTS and applied policy commit together; the stable tokenizer facade publishes immediately
  after commit. Shutdown/superseded candidates cannot publish. Never return empty search results for unavailable search.
- A tokenizer rebuild cannot overwrite a newer independent ranking change. Cleanup removes only narrowly named
  derived candidate tables, never authoritative facts/files. Legacy scan re-reads current files at reconciliation;
  ENOENT is a concurrent removal, while malformed/unreadable source prevents publication.
- Retention policy is numeric and captured per Run/operation/sweep. Existing explicit expiry stays authoritative.
  Legacy no-expiry rows use the accepted fallback on future sweeps. Startup sweep resumes after search recovery using
  the same timer owner. Native missing-resource rendering does not create fake Memory/model availability.
- Listener replacement binds and publishes authenticated discovery before closing old connections; failure preserves
  the old endpoint. Existing disconnect cancellation still applies; this is not seamless active-Run migration.
- Privacy disable retires active image evidence immediately. Old capture generations cannot republish. Viewing
  evidence captures retention policy before asynchronous media access.

## 4. Validation / Error Matrix

| Scenario | Required observation |
| --- | --- |
| Empty/keyless/incomplete Main | Home/config/history open; no automatic provider test; draft retained. |
| Candidate/secret/CAS failure | Previous active binding retained; failed/draft/conflict distinguishable. |
| Dropped apply acknowledgement | Reconcile actual Core revision before another write. |
| Invalid desired search, known old policy | Failed desired state plus actual old active value; matching index remains. |
| Unknown policy/version | No dependent search/Tidy dispatch; basic services stay reachable. |
| Crash around FTS commit | Old policy+index or new policy+index together; never infer applied from desired. |
| Concurrent rank/search changes | New ranking remains after search publication. |
| Listener bind/discovery failure | Previous listener/descriptor stay usable. |

## 5. Good / Base / Bad Cases

Good: applying a keyless Main enables the next reply without restart; held work retains its old model/key.
Base: Local search rebuilds asynchronously while configuration/history stay usable.
Bad: report applied after storage alone, use desired stoplist on an old index, silently spend on Main for invalid
explicit Utility, or rebuild the whole runtime for each scalar edit.

## 6. Tests Required

Model-profile service, real local-provider and native UI evidence cover coherent captures and recovery.
`runtime-configuration*.test.ts`, search-rebuild/policy-repo tests and Legacy concurrent-file tests cover index
publication, rollback/reopen, admission and state truth. Retention/queued-Tidy tests cover old/new numeric policy.
`ws-listener.test.ts` uses real sockets. Perception tests cover immediate retirement and late-capture fencing.
Keep deterministic checks, real process/native evidence and owner acceptance separate; paid calls need authorization.

## 7. Wrong vs Correct

```ts
// Wrong: desired configuration can outlive a crash that never published its index.
const tokenizer = createTokenizer(source.resolve("TAKI_MEMORY_STOPLIST"));

// Correct: use committed projection policy; unknown requires reconstruction before dependent work.
const search = createLiveSearchTokenizer(projectionPolicies.appliedStoplist(identity));
// Commit FTS replacement + projectionPolicies.write(identity, candidate) in the same transaction.
```
