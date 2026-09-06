# Complete command approval disclosure

## 1. Scope / Trigger

Read this before changing exec approval presentation, its Host/Core handshake, credential masking,
canonical challenge serialization or the Desktop/CLI command renderer. D64 applies only to effective
`ask` exec preflight. Core governance and final Host enforcement still decide execution. The policy
and compatibility decision is recorded in `09-05-uiux-readable-operations/design.md` section 5.

## 2. Signatures

Shared defines optional `ApprovalPresentation.commandDisclosure`:

```typescript
{
  revision: 1;
  complete: true;
  encoding: "visible-escapes";
  reconstruction: "section-field-concat";
}
```

`reconstructApprovalCommand(presentation: ApprovalPresentation): string | undefined` joins all
section/field values in array order with an empty separator when marked; otherwise it returns
undefined. The optional operator-only connect offer/echo is
`approvalCommandDisclosureRevision?: 1`, stored only on the authenticated physical Connection.

Marked exec challenge requests use the existing JSON-RPC method with string ID
`challenge:<requestId>:<challengeId>`. Host protocol stays v3, catalog v2; no new authority store,
permission cell, classifier revision, background-consent revision or database migration is introduced.

## 3. Contracts

- The Host projects the exact sealed `request.input.command` before hashing the final challenge.
  Resume executes the original pending input, never reconstructed display text or dequoted argv.
  Distinct raw inputs remain differently bound even when their masked displays are identical.
- Policy A preserves complete permitted command content, quoting, order and ordinary paths, while
  fully masking recognized credential values. Unrecognized free text remains visible to the
  authenticated approving operator. Do not claim universal secret detection.
- The pure scanner uses source ranges and a finite documented recognition family: credential
  option/assignment names and suffixes, authorization/cookie headers, URI credentials, known token
  prefixes/JWTs and private-key blocks. Match complete values, including adjacent quote fragments;
  no token head/tail preservation or fixed-prefix detection ceiling. Ambiguous recognized boundaries
  refuse disclosure. Ordinary path-purpose FILE/PATH fields and unrelated short options stay visible.
  Short credential aliases are program-context-specific. No I/O, shell parsing, expansion or resolution.
- Mask before chunking. Escape literal backslashes, CR/LF/TAB, C0/DEL/C1, Bidi controls
  U+061C/U+200E/U+200F/U+202A..U+202E/U+2066..U+2069, U+2028/U+2029 and the finite invisible set
  U+00AD/U+200B..U+200D/U+2060/U+FEFF. Actual controls and literal escape-looking text must differ.
  Preserve other printable Unicode without normalization; the display is not a copy-back command.
- All marked field values are command chunks. Each satisfies both 500 UTF-8 bytes and 500 UTF-16
  units; reject lone surrogates. Pack scalar/escape/marker atoms into at most 12 fields × 8 sections.
  Explanations and other values stay outside those fields. Entire content fits or the operation is
  refused; never mark an ellipsis/truncated tail complete. Output is bounded and scanning is linear.
- The optional marker is covered by the existing challenge digest. Absent means omitted, including
  Rust serialization; it must not inject null/default values or change legacy canonical bytes.
- Every connect success branch, including loopback auto-trust, records/echoes only a supported actual
  operator offer. Do not advertise it through execution capabilities or Host declarations. Reconnect
  negotiates again; another window's support does not cover the initiating connection.
- Desktop/CLI check the echo before successful promotion/restoration. Missing echo is a readable
  local compatibility error with `code: null`, not AUTH_FAILED. Preserve existing pairing tokens.
- Core validates provenance/control/digests/evidence first, then refuses missing Host disclosure or
  unsupported initiating operator before Approval, intent or resume. Send fixed safe DENIED and Host
  cancellation. No-operator keeps APPROVAL_REQUIRED; non-exec and auto preflight are unchanged.
- Register the sealed pending challenge before send. Match both RPC-ID UUIDs against the current
  session's pending slot. Success ACK never authorizes execution. Rejection/malformed result/RPC error
  atomically clears that exact pending input and active attempt and produces one finite DENIED.
  Late/replayed/unrelated ACKs cannot affect consumed, cancelled or newer operations.
- Cleanup validates an already received request's exact active/pending binding, not whether its
  policy generation is still the newest observed one. A newer request cannot make an older exact
  cancel/ACK retirement leak pending input. Execution/resume keeps its current-policy validation.
- A resume with a foreign challenge/control tuple cannot consume or retire another pending slot.
  For an exact tuple, invalid authorization atomically retires pending input and active state once;
  successful validation and consumption share the same session lock. Execute validation and input
  consumption also share that lock. A Host-local denial does not weaken Core lineage validation.
- Build/send failure clears local state; build failure immediately returns original ask evidence
  with exact request/control. Do not fabricate default evidence. Socket loss still uses existing
  disconnect/deadline settlement; a local send attempt does not prove delivery.
- No command/display persistence or new raw denial logs. Preserve the existing restricted original-
  command execution/final-floor audit. Ordinary diagnostics contain at most identity, finite category
  and structured outcome; never peer error data or matched credential fragments.
- Desktop and CLI render the same literal join. No chunk labels, inserted newlines, HTML/Markdown,
  synthetic shell links, invisible truncated tail, binding metadata or revision display. Keep an
  accessible selectable/scrolled command region and existing approval focus/choice/expiry behavior.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| New Host/Core/operator with supported echo | Complete typed command prompt; original one-shot execution binding |
| Legacy Host classification-only exec ask | Core DENIED + Host cancel before prompting |
| Legacy operator without offer | Core DENIED + cancel; no unparseable marker-bearing prompt |
| Old Core rejects marked challenge | Correlated ACK handler returns safe terminal denial without re-pairing |
| New client receives no support echo | Visible compatibility failure, no successful restoration/token clearing |
| No initiating operator | Existing APPROVAL_REQUIRED behavior |
| Over-capacity or ambiguous recognized secret | Immediate sanitized denial; no partial prompt or raw audit |
| Replayed rejection after resume or for old challengeId | Ignore; no cancellation, second response or execution |
| Foreign resume tuple or exact invalid authorization | Foreign tuple leaves pending state intact; exact invalid authority retires once without execution |
| Legacy unmarked non-exec presentation | Existing parsing, canonical bytes and ordinary rendering |

## 5. Good / Base / Bad Cases

- Good: a full command with a credential argument displays its entire permitted tail and a fixed
  hidden-value marker, while authorization remains tied to the untouched raw input digest.
- Base: an ordinary screenshot challenge retains its old golden canonical hash and presentation.
- Bad: rebuild from argv, mask each already-split chunk, expose credential ends, use a Chinese title
  as a type tag, or change Host version constants while retaining token-deleting AUTH_FAILED handling.

## 6. Tests Required

Whole-value recognition and exclusions; mixed quoting/adjacent fragments; long credentials/private
keys; malformed recognized boundaries; 499/500/501-byte text, CJK/emoji/combining text, 96/97 chunks
and post-escape overflow; literal versus actual controls; cross-language marked fixture plus old
goldens; identical display with distinct raw bindings; every authentication path; old peer refusal;
success/rejected/malformed/late ACK races; exact pending cleanup; once-only resume and original audit.
Include multibyte text immediately before a URI, quoted token/URL values with appended unquoted
fragments, and old pending cancellation after accepting a newer policy generation. Byte offsets
must end on Unicode boundaries, and a partial recognized token must not leave a credential tail.

Real isolated Core/Host L1 approval, deny and disclosure-failure paths must prove execution count and
no diagnostic leakage. Actual WebView2 verifies full text/tail/selection, keyboard scroll/focus,
choices, narrow layout and compatibility feedback. Synthetic DTO UI tests do not prove Host masking.

## 7. Wrong versus Correct

```typescript
// Wrong: transport chunk boundaries are not source newlines.
const shown = presentation.sections.flatMap((s) => s.fields.map((f) => f.value)).join("\n");
// Correct: Shared performs the typed reconstruction; render the returned value literally.
const shownCommand = reconstructApprovalCommand(presentation);
```

Lifecycle and authority remain governed by [host-operation-lifecycle.md](host-operation-lifecycle.md)
and [permission-authorization.md](permission-authorization.md). General names/history metadata follow
[operation-presentation.md](operation-presentation.md).
