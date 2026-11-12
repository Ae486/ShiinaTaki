# Real-data attribution outage diagnosis (2026-11-04)

Subsequent status: the owner approved the repair, which is now implemented and verified against all 147 captured
primary requests. See [delivery record](model-identity-catalog-delivery.md). The diagnosis below preserves the
pre-fix evidence and the authorization boundary at the time it was written.

## Finding and current status

The Monitor observation slice has a reproduced production-read defect. Valid request composition is stored, but `request-attribution-repo.ts:55` rejects the whole projection when the requested model name differs from the provider-reported response model name. This invalidates the earlier assumption that automated observation acceptance covered this configured provider.

This turn is diagnosis only. No production code, user database, service lifecycle, task status, commit or archive was changed. No model calls were made. The proposed repair below has not been implemented.

## Evidence source and scope

- Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `a2269ad` with existing uncommitted task changes preserved.
- Session task resolution: `python .trellis/scripts/task.py current --source` returned this parent task, rather than the stale global task pointer.
- Database: `C:/Users/55473/.takiagent/taki.db`, including its WAL. This matches the bootstrap default and predecessor real-data evidence; `.env.local` and the investigating process have no `TAKI_DATA_DIR` override. New conversation records end at `2026-11-03T14:44:00.122Z` (22:44 Asia/Shanghai). No live provider/WS/UI interaction was used in this diagnosis.
- SQLite was queried with Python URI `mode=ro` and `PRAGMA query_only=ON`. The actual TypeScript projection was separately invoked through a read-only `node:sqlite` adapter, without `openDatabase`, migrations or Core startup.

## Reproduction and hypothesis checks

The unmodified production `createRequestAttributionRepo(db).read('taki')` returned:

```json
{"scope":"latest-primary-request","characterId":"taki","status":"unavailable","reason":"data-inconsistent","request":null}
```

Ranked hypotheses were request identity disagreement, invalid latest-request/source selection, and partial provenance incorrectly hiding otherwise usable composition.

1. All **157** stored `context.request.measured` payloads validate against the current schema: **147 primary**, **10 other**. They continue through the latest request. For the measured primary requests, source sequence, measurement sequence binding, single source per Run and committed Effect intent association agree.
2. All **146 primary requests with reported usage** use `deepseek-v4-flash` in their Effect/measurement and `deepseek-flash` in `run_usage.model_id`. Provider identity is equal. The remaining measured primary request failed with `provider_error`, unknown usage and no input count; it retains the requested model name in usage. That failure occurred on November 2 at 17:10:22 Asia/Shanghai and explains a request whose composition can pass the name check while later successful requests fail it. This is consistent with the reported intermittency; no historical UI frame was captured.
3. A diagnostic adapter substituted **only the returned usage model name in memory** for the latest read. It immediately changed the production projection to `status: partial`, `reason: null`, with reported input **97,444**, effective window **131,000**, and all nine category counts totaling **93,831 estimator units**. This was a hypothesis probe, not a production fix or historical rewrite.
4. Latest partial provenance is separate: **10,638 estimator units** have unknown tool-interaction supplier, and unestimated part count is zero. Existing UI supports displaying that partial composition. Unknown provenance is not the cause of the whole-strip outage; the underlying reason for those individual unknown suppliers was not investigated here.
5. The 12 older primary model requests on November 2 preceding attribution capture have no measurement events. Their absence is a pre-capture boundary, not evidence of the later recorder stopping.

## Confirmed data path

```text
Configured/requested model: deepseek-v4-flash
  -> model-effect-middleware.ts:83 commits model Effect sourceRef
  -> request-attribution-observer.ts copies that Effect identity

Provider response model: deepseek-flash
  -> openai-compatible adapter converts response metadata
  -> AI SDK end callback exposes responseModelId
  -> model-observability.ts:107 writes provider-reported usage identity

Same effect_id joins both facts
  -> request-attribution-repo.ts:55 demands equal model-name strings
  -> data-inconsistent + request:null
  -> UI has neither occupancy nor composition to render
```

Installed versions checked: AI SDK **7.0.148**, OpenAI-compatible adapter **3.0.75**. In `ai/src/generate-text/stream-language-model-call.ts`, line 446 initializes `responseModelId` from the requested model; line 839 replaces it with response metadata; line 644 uses it for the end callback. The adapter sends `this.modelId` in the request and obtains response metadata from the returned `model` field. Therefore the two strings have different valid meanings. This evidence does not prove which internal weights the provider served.

## Minimal read-only SQL confirmation

Use `sqlite3.connect(Path(db_path).as_uri() + '?mode=ro', uri=True)` and `PRAGMA query_only=ON`; query only selected accounting fields, never full conversation bodies:

```sql
SELECT json_extract(m.payload_json, '$.population') AS population,
       json_extract(e.source_ref_json, '$.modelId') AS requested_model,
       u.model_id AS response_model,
       u.quality,
       COUNT(*) AS requests
FROM run_events m
JOIN run_effects e ON e.effect_id = json_extract(m.payload_json, '$.effectId')
LEFT JOIN run_usage u ON u.effect_id = e.effect_id
WHERE m.kind = 'context.request.measured'
GROUP BY 1, 2, 3, 4;
```

## Proposed repair and acceptance

- Keep the existing Effect identity as request correlation. Distinguish the requested model from the response-reported model; do not require their names to match or hardcode a DeepSeek alias table.
- Preserve genuine request/source/Attempt inconsistencies as errors. Do not turn unknown usage or provenance into invented zeroes or complete coverage.
- Read existing records correctly without rewriting the immutable ledgers. No new model request or composition backfill is required for these 147 measured primary requests.
- Add a regression at the real adapter/observer/projection boundary where request and response model names differ. Preserve provider-reported response facts and verify input/window/composition remain visible.
- Retain coverage for missing usage, failure, mismatched request lineage, multiple tool steps and next-request refresh. Check the existing stored cohort with the repaired read path.
- Existing integrated helper `verify-monitor-runtime-ui.mjs:47` and `:51` always returns the configured `primaryModel`. It never exercised response model renaming. Its 19 passing stages remain valid for their original inputs; they do not establish compatibility with this real response.

The parent remains active. Fixing this concrete Monitor defect precedes relying on its UI for the planned token-efficiency analysis. New long-command cost analysis remains outstanding.
