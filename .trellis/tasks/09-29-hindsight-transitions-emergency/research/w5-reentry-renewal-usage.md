# W5 explicit unadmitted reentry renewal

This task-only option supersedes exactly one reviewed expired reentry request that has
never been admitted. It does not recover a transition, extend a preview, authorize a
model request, change maintenance allowances or reapply Local edits. Do not run the
real pair until the parent has independently checked the implementation and authored
the exact approval file. No real approval or replacement was created by the implementer.

## Parent-authored approval

The JSON shape is below. All placeholder values must be replaced with independently
reviewed evidence. `renewalId` is a new parent-assigned UUID, not an operation/request ID.
The approval is consumed only once by the append of a linked replacement submission.

```json
{
  "version": 1,
  "kind": "renew-unadmitted-reentry",
  "renewalId": "PARENT_ASSIGNED_UUID",
  "requestId": "9a90f97e-a831-48b2-95e5-34f740bb8d2d",
  "previewId": "784eeb71-7680-46bb-a1d8-8f0aec472797",
  "requestHash": "SHA256_OF_RETAINED_REQUEST_JSON_STRINGIFY",
  "previewHash": "SHA256_OF_RETAINED_PREVIEW_JSON_STRINGIFY",
  "returnAnchorHash": "SHA256_OF_RETURN_ANCHOR_JSON_STRINGIFY",
  "localMutationHash": "SHA256_OF_LOCAL_MUTATION_JSON_STRINGIFY",
  "localChangesHash": "SHA256_OF_LOCAL_CHANGES_JSON_STRINGIFY",
  "checkpoint": {
    "sequence": 1,
    "payloadSha256": "EXACT_CHECKPOINT_ENVELOPE_SHA256_FIELD",
    "fileSha256": "SHA256_OF_EXACT_CHECKPOINT_FILE_BYTES"
  }
}
```

`previewHash` here hashes the complete retained preview serialization; it is distinct
from the preview's internal `previewHash` field. Object hashes use the UTF-8 bytes of
`JSON.stringify` over the corresponding retained checkpoint object, preserving its
key order. Do not hash a Zod-parsed/reordered object or a Python default JSON encoding.
The checkpoint's own sequence/payload hash and raw file hash must all match. The helper
loads the named immutable `journey-checkpoint-history/<sequence>-<payloadSha256>.json`
when present, otherwise the exact current checkpoint. Neither source is rewritten.

The reviewed checkpoint must contain the one old submission, completed RETURN anchor,
exact planned Local mutation, and recorded `localChanges`. An old submission with an
operation ID, transition ID or supersession link cannot be renewed. The actual driver
additionally pins the original request/preview IDs above and accepts the option only
for `run --stage reentry`.

## Invocation

Use the previously approved Native Python interpreter and the existing finite cumulative
submission cap. The new flag is separate from `--maintenance-approval`:

```text
<approved-python> .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-reused-native.py run --stage reentry --submission-cap <existing-approved-cap> --reentry-renewal <parent-reviewed-approval.json>
```

The supervisor resolves the supplied file, validates the mode/stage, and retains its exact
bytes as `attempt-history/<attempt-id>/reentry-renewal-approval.json` before forwarding
that retained path as the last Node driver argument. This option neither grants network
model access nor changes the billing latch/counter or per-Bank maintenance gate. Without
separate maintenance approval, the original zero-model staged pause remains mandatory.

## Guarantees and restart behavior

1. Before any new preview, the helper checks exact stored preview identity and absence
   of the old request in operations, intents and recoveries. Orphan rows are a refusal.
2. It validates the actual complete RETURN publication/candidate/selected epoch and the
   original policy receipt/snapshot/current record plus exact desired Block revision/body.
   The driver uses this read-only Local check instead of mutation reconciliation while
   the renewal option is active; no missing mutation is automatically applied.
3. Expensive RETURN/Local validation precedes the fresh preview. The real preview then
   performs its normal current-identity/readiness checks and creates normal timestamps.
   After its await, old-request absence and reviewed state are checked again. A changed
   expected identity, actor, kind or recovery shape refuses.
4. New preview/request IDs, the original request/preview hashes, approval file hash,
   approved checkpoint identity, replacement hashes and reason/time are appended to
   `journey.submissions` as `supersession`, before ordinary `owner.submit`. Original
   entries and immutable checkpoint history remain unchanged.
5. A crash before the append leaves no authorized request to dispatch. A repeated explicit
   invocation may retry the normal preview; an unused preview alone is not an admission.
   A lost append/submit acknowledgement reloads the one linked replacement. Its exact
   existing operation is reconciled even if cancelled, completed or outcome-unknown;
   the helper never allocates a further replacement for it.
6. A still-unadmitted linked replacement must remain unexpired and pass current read-only
   validation. If it expires, stop with `W5_RENEWAL_REPLACEMENT_EXPIRED`. A different
   approval/renewal identity or multiple successors refuses. Do not delete the link or
   regenerate IDs to bypass that bound. Actual transition recovery after admission uses
   the existing separately reviewed recovery flow, without this renewal option.

The actual staged reentry/Native plan and real model budget remain parent-owned acceptance
steps after independent review. This helper does not mark those gates complete.
