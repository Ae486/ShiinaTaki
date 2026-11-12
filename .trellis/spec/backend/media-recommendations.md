# Native recommendations and bounded pre-analysis

## 1. Scope / Trigger

Use for OpenBili recommendation/profile/native-feedback access and preparation of a small selected video subset.
The ordinary Agent, captured MCP tools, existing primary-source binding, Run/Attempt/Effect ledger, Character queue,
and shared media-analysis catalog/progression remain authoritative. Co-Watching acceptance is a separate operation.

## 2. Signatures

- Native `GET /api/recommendations/peek?limit=20` returns
  `{ items: RecommendationOut[], source: "existing_recommendations", total, has_more }`; `limit` is 1..20.
- MCP: `openbili_peek_recommendations(limit)`, `openbili_read_recommendations(limit)`,
  `openbili_read_profile()`, `openbili_submit_feedback(request_id, recommendation_id, feedback_type, note)`.
- The `taki-media-recommendations` Skill discloses `manage_media_recommendations` on the next model step.
  Its required fields are `action`, nullable `videoUrls`, `lifetimeMinutes`, `batchId`, and `jobRequestId`.
  Actions are `prepare_recommendations`, `preparation_status`, and `preparation_cancel`.
- Preparation accepts 1..3 distinct canonical Bilibili URLs, preserving `?p=N`; lifetime is 5..720 minutes,
  with null selecting 120. Status accepts null batchId for the latest batch. Cancel requires an exact batchId;
  optional jobRequestId narrows cancellation to one returned item.

## 3. Contracts

Peek reuses the native filtered current recommendation-history view without top-up, serving, ordinary-list cache,
or history/event/pool/presented/seen writes. `total` counts the native current view, at most 20; it is not all history
or fresh-pool inventory. An empty peek does not authorize a side-effecting browsing fallback.

Ordinary native recommendation GET may top up history and consume pool entries. Its MCP annotation is neither
read-only nor idempotent. Pool `shown`, native `presented`, internal selection and successful reads do not prove
user exposure. Real clicks are separate facts; no selection/preparation path manufactures them.

Profile output is bounded and source-attributed with a read time. Inferred interests can include manual overrides;
the projection does not establish verified user facts or field-level authorship. Do not automatically mirror it
into Memory. Native uninitialized/failure states remain explicit.

Feedback supports native like/dislike/comment/dismiss, not Bilibili account actions. Comment requires a note.
Retain one request_id and identical payload across uncertain retries; conflicts are terminal for that key.
Success means queued processing, not completed learning. Direct viewing, Co-Watching acceptance, defer and silence
never manufacture content feedback.

The optional bridge `--openbili-config` contains a fixed backend_url, auth_token_env reference, total_timeout_seconds
and response_bytes. Credentials remain in the operator-provided process environment. Missing/unavailable OpenBili
does not retire the six existing BiliNote tools. Fixed origin, no redirects, response limits and sanitized failures
apply independently to both clients; their transports must close on cooperative EOF.

Preparation requires an authenticated actual primary chat Run/Attempt and committed user Timeline row. Transport
messageId, Run triggerRequestId and Timeline entry ID are distinct identifiers. Bind the real row through the existing
primary-source owner used by Patterns/Intentions; do not compare unrelated UUIDs or create another source ledger.
Check current source authority across admission awaits. Once accepted, retained work may finish after its parent
conversation settles. Heartbeat/scheduled entry and full process-restart Continue remain unsupported in this slice.

One active batch per Character reserves at most three items and executes them sequentially within the existing
64-job bound. Concurrent same-key calls await the original admission result; an originally refused admission cannot
become accepted merely because a batch record exists. Changed same-key payloads conflict.

Recommendation jobs have immutable `recommendation_preanalysis` purpose and no prepared-publication authority.
Success/failure settles before final-summary generation or publication. Native request/result identity, same-part
reuse, uncertain-submit reconciliation, cancellation and generation leases are shared with explicit URL analysis.
No callback generates commentary, invitation, completion speech, click or feedback. Existing explicit analyze_url
retains its ordinary once-only final answer. Stopping preparation retains completed native results and does not
claim remote native computation stopped.

## 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| Empty existing recommendation view | Successful empty peek; no serving or native initialization |
| Missing/invalid OpenBili configuration, auth failure or unavailable native registry | Structured failure; BiliNote remains independently usable |
| Changed feedback payload with retained key | Conflict; never mint a replacement retry key |
| No real primary source, retired source during admission, or missing source port | source_unavailable; no native work |
| Duplicate URLs, invalid count/lifetime/action fields | invalid_request |
| Same-key pending or refused admission | Same settled outcome; no premature acceptance |
| Another active batch or full runtime capacity | already_active or not_ready |
| Native submission outcome unknown | Reconcile original request; no duplicate request |
| Cancel/shutdown/late result | Stop only owned pending work; no late speech or unrelated cancellation |

## 5. Good / Base / Bad Cases

- Good: peek existing recommendations, select two exact videos, prepare them, and inspect retained results later.
- Base: native data is uninitialized, so report that state without inventing a profile or generating recommendations.
- Bad: call the serving GET for internal selection, interpret direct viewing as dislike, or reuse explicit analyze_url
  to implement silent preparation while discarding its final reply after publication.

## 6. Tests Required

Assert real native HTTP/auth/SQLite peek performs no writes and does not share serving-cache behavior. Cover empty,
bounded/filtered history, feedback exact retries/conflicts and bounded attributed profile responses.
Exercise actual Python MCP stdio through the installed client and provider-wire disclosure: initial schemas hidden,
exact describe reveals only that tool, unavailable OpenBili leaves BiliNote available, and both clients close on EOF.

Exercise real chat.send -> ChatAgent -> captured Skill -> tool -> runtime with three distinct IDs. Assert actual
primary-source binding, shared pending/refused admission, sequential exact-part reuse, original unknown-request
lookup, capacity and cancellation. After the primary turn ends, native-only completion adds neither model calls nor
Timeline entries. Keep explicit URL answer and its once-only publication regression.

## 7. Wrong vs Correct

```ts
// Wrong: two separately minted identifiers are not a source-authority proof.
if (run.idempotencyKey !== userEntry.id) return unavailable;

// Correct: the trusted chat seam registers the actual row with the existing source owner.
primarySource.register({ characterId, runId, attemptId,
  userTimelineSeq: userEntry.seq, userTimelineId: userEntry.id });
// Validate that source throughout admission; retain accepted work independently afterward.
```

Deployment/current verification: [OpenBili deployment](../../../integrations/openbili-deployment/README.md).
Product decisions: [M53-M59](../../../docs/MEDIA-INTEGRATION.md).
