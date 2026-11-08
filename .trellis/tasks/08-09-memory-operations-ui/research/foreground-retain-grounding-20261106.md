# Foreground retain grounding correction

## Trigger and required behavior

Real official-API run `G:/taki-real-memory-X0GDzD` repeats the source-attribution defect: the user's one-day study
statement is retained and retrieved, but assistant questions/interpretations also become an established recurring
habit and inferred user acceptance of being prompted. This is a content precision failure despite successful I/O.
Keep the entire eight-message genuine fixture, including the difficult assistant statements.

Store supported facts with their actual speaker/source, distinguish plans from completed actions and one-off
events from recurring habits, and preserve original historical dates in content/context. Foreground `retain`
write/mention metadata legitimately uses the new live turn's current timestamp; do not change that contract.

## Smallest production correction

The existing shared `memory/write-convention.ts` owns write eligibility, transcript grounding and absolute-date
wording. Automatic extraction imports it; `canonical-tools/retain-tool.ts` currently exposes only safe-content
wording. Reuse that existing owner rather than create a validator, second model call or parallel prompt policy.

1. Clarify the shared voice rule: preserve speaker/action attribution; assistant questions, suggestions and
   interpretations do not establish user confirmation; a one-off event/plan does not prove a habit, completed
   action or enduring preference. Relevant assistant commitments may remain attributed assistant memories.
2. Compose the foreground retain description with the existing shared write/voice fragments. Keep explicit-user
   remember override, real layer vocabulary, schema, execution, errors, source custody and storage unchanged.
3. Preserve one canonical wording owner. This adds a small stable prompt cost and guides behavior; it is not a
   deterministic guarantee of semantic truth and must be evaluated against the observed failure.

## Verification and ownership

- Do not change production source while the current baseline Core is running. Preserve that result first.
- The implementer owns only `memory/write-convention.ts`, `canonical-tools/retain-tool.ts` and their existing
  folder index descriptions. Root owns task records and live dispatch. No schema/migration or Native source edit.
- Relevant existing memory/tool tests, Core typecheck, scoped lint and whitespace checks. Do not add exact-string
  tests that merely copy the new prompt.
- Use the unchanged genuine source slices through a fresh actual Core. Record the effective retain-description
  hash at the existing request observer, without logging private request bodies. Inspect persisted content and
  recall answer for unsupported user attribution, habitual claims and date loss, as well as actual tool receipts.
- Complete the remaining Hindsight integration gate once its current Pending state is understood; do not turn
  a failed/unknown write or an insufficient harness budget into successful acceptance.
