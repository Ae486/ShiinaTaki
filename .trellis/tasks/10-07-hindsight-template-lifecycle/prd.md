# Hindsight versioned template and user-overlay lifecycle

## Goal

Complete Stage 5B under the existing B7 plan: an operator can preview, apply, customize, update and remove the
Taki Bank overlay while preserving Native defaults, unrelated configuration/resources and explicit user choices.
The resulting per-fact layer configuration must reach actual canonical policy through trusted Native evidence.

## Status and authorization

Stage 5B isolated automatic acceptance **PASSED on 2026-10-13**. All eleven automatic criteria below are accepted
against the independently reviewed implementation and final source/check reconciliation in
[the automatic acceptance report](research/b3-whole-acceptance.md). The owner authorized this continuation
through 5B, stopping before 5C. The existing task remains `in_progress`, uncommitted and unarchived.
Installed/manual and original-environment acceptance remain separate. Real-data legacy collisions, destructive
enrollment, original services/data/credentials, actual model calls and Git lifecycle actions are outside this scope.

## Requirements

1. Version the Taki built-in template and explicit user customization independently. Preserve immutable v1 and
   support legacy Banks without pretending they already have managed ownership history.
2. Compose Native inherited defaults, Taki-owned additions and highest-precedence user changes. Preserve explicit
   user choices even when equal to an earlier Taki value. Support deliberate suppression and return to inheritance.
3. Preview exact changes, conflicts, resource deletions and possible model work before application. Reading or
   previewing performs no mutation, initialization, embedding or refresh. Unsupported instances remain usable.
4. Bind every application to exact target identity and the reviewed state. Concurrent/external edits refuse safely.
   Apply one Bank's config/resources and recoverable outcome atomically. Multi-Bank work reports partial progress
   truthfully and can resume the original request after a disconnect or restart.
5. Capture real preexisting Bank overrides and resource identities before taking ownership. Restore captured values
   or inheritance when removing Taki. Preserve complete user-owned resources. Delete only exactly identified,
   proven-owned resources shown in the reviewed plan; no whole-Bank reset or automatic adoption of collisions.
6. Keep desired, applied, runtime-bound and derived-content states distinct. Template changes must preserve the
   existing authority, operation exclusion, source-custody, synchronization and runtime replacement guarantees.
   A binding failure after selection publication recovers the committed selection, without repeating Native writes.
7. New Character Banks inherit the admitted scope-specific built-in version. Per-Character customization remains
   local to its Bank. Removing Taki does not disable Hindsight or change memory authority.
8. Configure controlled per-fact `taki-layer:*` classification using the existing registry and `unclassified`
   fallback. Preserve unrelated labels/free-form entities and user suppression. Connect exact per-unit Native
   evidence to the existing trusted-label policy input; uncertain, wrong-scope, pinned or undisclosed mood-gated
   labels stay neutral. Original/curated policies retain priority.
9. Preserve template/user revisions, ownership and exact outcomes through paired backup/restore and healthy
   return/reentry. A changed Native Bank incarnation cannot inherit old ownership by Bank ID alone.
10. Home uses Core-owned operations and evidence, with actionable unsupported, untracked, conflict, partial,
    stale, failed and recovery states. Reopening observes the original operation; status reads never repeat writes.

## Acceptance criteria

- [x] Independent template updates preserve explicit user values/suppression, unrelated config/label groups and
      resources; user reset reveals current template/base; Taki removal preserves user resources and surviving
      user label overrides, restoring original inheritance only when the recomposed result needs no Bank override.
- [x] Fresh/enrollable Banks acquire evidence-backed ownership. Existing bases require explicit reviewed enrollment;
      unreviewed same-ID/name collisions, duplicate directives, missing legacy before-images and external edits
      refuse without overwriting or inventing history.
- [x] Actual Native authentication, Bank restrictions, field/action permissions and failure paths fail closed.
      Faults inside one Bank mutation roll back resource rows, logical changes and the receipt together.
- [x] Overlapping effective mutations against the same snapshot have one winner; independent no-ops may each
      receive a receipt without logical changes. Same request/hash recovers its original result;
      changed identity/hash refuses. No duplicate job admission on replay; external provider retry limits are explicit.
- [x] Actual extraction with fake providers reaches per-fact entities/tags, replica/application binding and canonical
      policy; missing/invalid/multiple/cross-scope labels and pinned/mood-gated cases retain neutral safeguards.
- [x] Interruptions before/during/after each Bank application and Core publication preserve original request IDs,
      partial outcomes, exact target revisions and final lease/epoch guards. Post-commit recovery only rebinds.
- [x] A durable unpublished-effect hold survives failed/unknown operation status and restart; memory reads,
      reflects, writers and conflicting operations cannot consume a mixed rollout before original-plan recovery.
- [x] Structured per-fact label provenance is server-owned and bound to exact current unit identity/revision;
      copied content-wide entities/tags or caller metadata cannot establish classification evidence.
- [x] Fresh and historical migrations/reopen pass; customized and removed overlays survive an isolated paired
      restore. Mismatched pairs refuse. Native backup table parity and required remote receipt accounting are complete.
- [x] Old v1 and 5A compatibility remain supported; new capability is optional; mandatory transition contracts and
      whole-manifest preview invalidation remain enforced; active/new Character paths use the selected overlay.
- [x] Actual operator dispatch and Home controller/DOM paths prove preview/apply/reconnect/two-observer behavior,
      truthful partial/derived state and absence of model work on reads. Relevant project checks pass.

## Out of scope

- Managed deployment and model-provider application (5C), candidate upgrade execution (5D), general cleanup (5E).
- Reclassification of old documents, daily model review, expanded curator behavior, or a new taxonomy (D79-D83).
- Reconstructing lost pre-v1 values, forced adoption/removal on an original Bank, real model calls, original data,
  installed/manual acceptance, performance optimization, commit, push, finish or archive.

## Research references

- [Current template lifecycle research](../10-07-hindsight-configuration-observation/research/stage5b-template-lifecycle-research.md)
  grounds exact Native mutation/tombstone semantics, ownership limits, policy consumption and recovery requirements.
- [Stage 5 residual map](../09-29-hindsight-transitions-emergency/research/stage5-readiness-2026-10-07.md)
  assigns B7/Stage 5/6 responsibilities and C16 boundaries.
- [Parent requirements](../08-09-hindsight-memory-provider/prd.md) retain user precedence, per-fact layers,
  logical change evidence and deployment/secret boundaries.
