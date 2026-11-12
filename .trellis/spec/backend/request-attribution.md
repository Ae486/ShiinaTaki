# Final model request attribution

## Construction and dispatch

- Retain the nine Shared categories and four supplier origins. Construct spans before text joins; do not parse
  headings or add metric markers to prompts. `builtin` means the known application supplier channel, including
  ordinary app conversation transport; it is not a claim that Core authored user text.
- Canonical/legacy Memory, selected initiative instructions, summary, current user/tail and native tool evidence
  preserve descriptors through existing projections. Assembly wrappers forward one synchronous render result.
  String-only callbacks remain unclassified where no descriptor exists.
- Tool definitions are final prepared active schemas, including each continuation's dynamic descriptions. Core tools
  disclosed by a Skill stay builtin; package text/resources and selected MCP/Skill bridge output retain their supplier.
- Optional Shared Timeline `contextOrigin` survives safe persistence and restores process-local replay sidecars.
  Provider content omits this field. Old absence stays unknown. Private reduction retains origins; reused historical
  pairs retain per-occurrence sources, while conflicting Attempt-local recovery bindings remain unknown.
- Existing ModelUsageOwner Run scope carries the already committed Effect into final native post-filter dispatch.
  Never correlate using outer pre-filter params, generation call ID, latest Effect or last completed request.
- Each physical request, retry and continuation emits an optional context-request.v1 fact via lifecycle.record:
  counts, dispatch order, model/window and coverage only. No transcript, credentials, pixels, second usage authority
  or model request is added. Optional observer failure cannot cancel or retry otherwise valid model work.

## Estimation and coverage

- Use the existing heuristic estimator. Cumulative fragment rounding reconciles to whole text estimates. Known
  message/list framing is other/builtin and does not make counted/source coverage partial.
- Ambiguous or unproved spans are other/unknown. Identical strings with different construction sources never borrow
  a category from another occurrence. Unsupported parts and missing origins stay explicit.
- Native images belong to their enclosing content category. Existing flat heuristic pricing sets hasHeuristicMedia;
  this uncertainty flag is independent of counted/source coverage. There is no image meter or exact component claim.
- WindowCalibrator owns the read-only snapshot. Reported input divides by captured effective real tokens; local
  estimated occupancy uses estimatorWindowUnits. Do not scale components to fabricate exact provider token counts.

## Required checks

- Installed-SDK wire fixtures compare requests with/without observation, first/continuation schemas, supplier versus
  activation, physical Effect identity and category/origin reconciliation.
- Native fixtures invalidate images at Effect intent and prove final measurement excludes unavailable pixels while
  optional observer failures leave valid model dispatch unchanged.
- Round trips cover all four origins, old absence, private reduction and native screenshots in a user role.
- Preserve ordinary agent-inbox Work instructions alongside private child instructions at every join. Existing
  inbox-yield and child-completion tests protect this boundary; no section may be dropped to obtain counters.

## Request and response model identity

### 1. Scope / Trigger

Latest-primary usage/composition reads must support provider-reported model names that differ from the requested ID.
The installed AI SDK end callback uses response metadata's model ID, falling back to the requested ID if absent.

### 2. Signatures

`LatestPrimaryRequestSnapshot.request` retains requested `modelId` and adds optional `responseModelId` from the
existing usage row. Old snapshots without the added field remain valid; no ledger migration is needed.

### 3. Contracts

Join usage by `effect_id`; its Run, Attempt and provider must agree with the selected Effect. Measurement identity
still agrees with the Effect's requested model and primary source. Neither model-name equality nor catalog lookup
is a condition for accepting this usage. Preserve both stored names; current alias metadata cannot rewrite history.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Same Effect lineage/provider, different response model | Display usage and composition; expose both names |
| Wrong usage Run, Attempt or provider | `data-inconsistent` |
| Wrong measurement model/source/Attempt | `data-inconsistent` |
| Unknown usage or missing measurement | Preserve current request and existing partial/missing semantics |

### 5. Good/Base/Bad Cases

Good: requested `deepseek-v4-flash`, response `deepseek-flash`, one Effect. Base: old snapshot omits response name.
Bad: discard otherwise valid statistics because two fields with different meanings have different strings.

### 6. Tests Required

Exercise the actual compatible SDK/ChatAgent/observer/SQLite chain across a tool loop with different requested and
response IDs. Assert preserved usage names and visible composition. Cover real lineage mismatches and legacy DTOs.

### 7. Wrong vs Correct

Wrong: `usage.model_id !== source.modelId` means corrupt accounting. Correct: correlate the existing Effect and
lineage, preserve the response model as a separate fact, and accept independent catalog availability.
