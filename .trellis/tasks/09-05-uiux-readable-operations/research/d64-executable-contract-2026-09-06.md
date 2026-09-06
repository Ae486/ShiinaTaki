# Research: D64 executable command-disclosure and compatibility contract

- Query: Define the smallest source-backed Rust -> Shared -> Core -> operator adapter for policy-A complete command disclosure, including immediate failure settlement, compatibility, exact authorization lineage, and tests.
- Scope: Internal code and project specifications; installed dependency manifests. This is a design recommendation, not an implementation or acceptance report.
- Date: 2026-09-06
- Task: .trellis/tasks/09-05-uiux-readable-operations
- Workspace: H:/TakiAgent-worktrees/t4; branch task/t4-skills-mcp-productization, verified by worktree metadata without running Git.
- Task source: task.py current --source returned "(none)" / "none". The legacy .trellis/.current-task points to 08-29-compaction-harness and is not the native session authority. The parent supplied this task explicitly; no pointer or lifecycle state was changed.
- Discovery: One jbcontext search, searched revision b62f20ac174a, followed by direct reads of current files. YCE was not used. Current files, rather than that indexed revision, ground the findings below.

## Findings

### 1. Recommended decision

Use a typed, optional command-disclosure marker inside the existing Approval presentation. For marked presentations, every existing section/field value is an ordered chunk of one complete masked-and-escaped command; reconstruction is concatenation with no inserted separator. Both Core and Desktop consume that type, never title or label text.

Add one explicit operator-only display-support field to connect, with a response echo and connection-local storage. No such operator negotiation exists today. Keep Host protocol v3 and catalog schema v2, and complete the existing challenge RPC acknowledgement path so an older strict Core can refuse an extended challenge immediately without losing the Host's pairing token. Core separately refuses an old Host's classification-only exec ask before creating an Approval.

This is narrower than a Host v4 cutover: it preserves supported non-exec Host traffic and the current pairing lifecycle while providing explicit failure for unsupported command approvals. Do not strip the marker to manufacture a legacy command prompt.

Policy A is selected by main under the owner's execution delegation. Complete permitted command structure, quoting, argument order, and ordinary paths remain visible to the authenticated initiating operator. Entire recognized credential values are hidden. Unmatched arbitrary text is permitted; neither this contract nor its UI copy promises detection of every secret.

### 2. Files found and source anchors

| File / anchor | Verified role or consequence |
| --- | --- |
| apps/desktop/src-tauri/src/ws_client.rs:240 | Request receive -> HostSession.begin -> preflight; only a started attempt enters the worker. |
| apps/desktop/src-tauri/src/ws_client.rs:539 | authorize_and_run keeps a sealed request clone; line 554 recomputes input_digest against its exact input. |
| apps/desktop/src-tauri/src/ws_client.rs:275 | Builds a challenge and then stores request.input. Lines 288-291 currently only log a build failure and return, leaving the active attempt unsettled. |
| apps/desktop/src-tauri/src/ws_challenge.rs:18 | build_challenge seals control digest, remembered scope, trusted evidence, and presentation together. Line 41 currently chooses presentation from capability name alone. |
| apps/desktop/src-tauri/src/ws_challenge.rs:47 | Current presentation explicitly excludes the command and is classification-only. |
| apps/desktop/src-tauri/src/host_approval_protocol.rs:27 | Rust presentation mirror; optional subjectLabel already uses omission rather than null. |
| apps/desktop/src-tauri/src/host_approval_protocol.rs:236 | Canonical challenge serialization includes the presentation in a fixed field order. |
| apps/desktop/src-tauri/src/host_approval_protocol.rs:317 | Rust enforces UTF-8 byte limits: field/risk 500, field label/section title 80, title/capability label 120, optional subject 160, 12 fields, 8 sections. |
| apps/desktop/src-tauri/src/host_session.rs:35 | PendingChallengeRecord stores the exact raw Value and the sealed challenge; it is not Debug-derived. |
| apps/desktop/src-tauri/src/host_session.rs:81 | One pending slot per request ID; consume removes it, cancel validates exact request/control before removing it. |
| apps/desktop/src-tauri/src/host_session.rs:183 | complete removes the active attempt and inserts its terminal cache record, but currently does not remove a pending challenge. The header's terminal-drop claim is stronger than this implementation. |
| apps/desktop/src-tauri/src/ws_client.rs:368 | Resume validates and consumes under one session lock before invoking any handler. It executes record.input, never presentation text. |
| apps/desktop/src-tauri/src/ws_challenge.rs:71 | Resume checks exact request/challenge IDs, full control equality, three digests, approval generation G/G+1, and issued/expiry ordering/current expiry. |
| apps/desktop/src-tauri/src/ws_client.rs:629 | Authorized-resume final Host enforcement and audit; audit_command at line 646 extracts the original input.command unchanged. |
| apps/desktop/src-tauri/src/capabilities_impl/exec.rs:38 | Executor reads raw command, runs the existing sandbox, and logs only exit metadata. command_of at line 59 is an existing extraction helper. |
| apps/desktop/src-tauri/src/capabilities_impl/exec/parser.rs:33 | Current parser strips quote delimiters, treats backslash literally, and returns Complex for unsupported unquoted syntax; it cannot reconstruct disclosure. |
| apps/desktop/src-tauri/src/capabilities_impl/exec/sandbox.rs:59 | Execution reparses and spawns only Simple argv. Approval does not make compound commands executable. |
| apps/desktop/src-tauri/src/gate.rs:28 | Actual ExecClass definition; the supplied gate/exec_class.rs path does not exist. |
| packages/shared/src/approval-schema.ts:32 | Strict operator presentation schema; field values use JavaScript string length, max 500 UTF-16 code units. |
| packages/shared/src/host-approval-schema.ts:17 | HostChallengePresentationSchema aliases the same operator presentation schema. |
| packages/shared/src/host-approval-schema.ts:80 | Canonical challenge wraps the parsed presentation under domain taki.host.capability-challenge, revision 1. |
| packages/core/src/server/methods/capability-challenge.ts:19 | Node-only ingress checks authenticated current Host provenance before forwarding to the broker. |
| packages/core/src/capabilities/capability-challenge.ts:40 | Validates request/Host/generation/duplicates; lines 207-227 validate exact control and digest/evidence. |
| packages/core/src/capabilities/capability-challenge.ts:101 | Bridges only to pending.target.operator.connection; line 124 forwards the sealed presentation unchanged. |
| packages/core/src/capabilities/capability-challenge.ts:147 | Denial settles the pending request and sends Host cancellation; allow revalidates, commits intent, and mints a resume using the original control. |
| packages/core/src/capabilities/capability-broker-state.ts:51 | Core also retains exact raw input only in its pending record; settlePending at line 86 releases it and retains bounded lineage. |
| packages/core/src/capabilities/capability-response.ts:43 | Failed terminal responses can carry ask evidence with no authorization. Success under ask requires the minted authorization. |
| packages/core/src/capabilities/capability-effect-lifecycle.ts:82 | Durable Effect input is identity/digests, not the command presentation; terminal metadata uses errorCode rather than error text. |
| packages/core/src/approval/approval-interaction-state.ts:83 | Parses the outgoing canonical request, targets the physical owner connection, and does not persist the presentation. |
| packages/shared/src/connect-schema.ts:14 | Operators must declare neither capabilities nor host. There is no operator display/version field. |
| packages/core/src/server/connection-registry.ts:8 | Authenticated state has deviceId, role, capabilities, optional Host negotiation; no operator display support. |
| packages/core/src/server/methods/connect.ts:110 | Host negotiation selects one supported protocol version. The loopback path at lines 98-102 independently constructs identity/result. |
| apps/desktop/src/lib/ws-client-routes.ts:155 | approval.request is strict-parsed before any handler; unknown presentation fields are not a safe legacy fallback. |
| apps/desktop/src/components/approval/approval-dialog.tsx:79 | Existing generic section rendering uses paragraphs, collapses ordinary whitespace, and inserts labels between field values. |
| apps/desktop/src/lib/ws-client-methods.ts:164 | Handshake parses ConnectResult but currently returns only token on success. |
| apps/desktop/src/lib/operator-auth.ts:22 | Shared authentication entry for Pet/Home/Chat; currently advertises an empty execution-capability list. |
| apps/cli/src/chat-client.ts:109 | CLI also strict-parses canonical Approval requests. Its handshake at line 144 also drops non-token success metadata. |
| apps/cli/src/approval-prompt.ts:15 | CLI currently inserts section/field labels and newlines; it needs the typed command reconstruction before advertising support. |

### 3. Authority, original-input, and audit invariants

1. Core creates the immutable Host operation control and its inputDigest. Rust preflight recomputes that digest over the same capability identity and input before classifying.
2. Preflight classifies but does not execute. Both effective auto and ask currently take the challenge/preflight route (ws_client.rs:559-575). Only exec plus effective ask needs operator command disclosure. Auto and non-exec traffic should not acquire a new display-capacity gate.
3. The Host creates the display from request.input.command, then seals the final display with the exact control/scope. It stores that same request.input in PendingChallengeRecord.
4. Core verifies the authenticated source, exact pending control, controlDigest, challengeDigest, classification revisions, and scope before any prompt. Rendering never feeds execution or policy.
5. Approval is owned by the initiating physical Connection. Exec cells are once-only in packages/shared/src/governance-registry.ts:40-47. No new session/always grant, future-background consent, classifier revision, or decision-scope change belongs to D64.
6. Resume consumes once before execution, rechecks final Host enforcement, and supplies record.input to the executor. Two distinct raw commands may produce identical masked display strings, but their inputDigest/controlDigest/challengeDigest must remain distinct.
7. Preserve the dedicated raw-command audit exception. Successful authorized exec and a final Host-floor denial still audit the original command via ws_client.rs:637-647. An operator denial, unsupported presentation, or disclosure build failure starts no effect and must not add a new raw-command audit row.
8. AuditSink's comment calls the command "normalized" (audit.rs:26), but the active ws_client call path passes the raw input string. Test the live behavior, not that adjective.
9. Do not add raw command, display text, raw input, token fragments, or redactor exceptions to logs, new Timeline records, caches, diagnostic responses, or durable Approval state. Existing raw tool-content or approved-exec audit behavior is not permission to create a second persistence path.

The digests are authenticated-channel integrity/binding checks, not digital signatures. Do not describe a SHA-256 digest by itself as proof that the Host's redactor recognized every credential.

Exec input context was checked explicitly: packages/core/src/capabilities/exec-tool.ts:23 defines only command; capabilities_impl/exec.rs:38-40 reads that command and passes self.policy.sandbox(), with no per-request cwd/timeout override. The effective cwd comes from ExecPolicy's optional operator-owned config/default (capabilities_impl/exec/policy.rs:110-123), while its timeout/output cap are policy defaults (line 140). The Host operation deadline is separately sealed in control. There is no implemented per-call cwd/timeout field for this adapter to hide or append to command chunks. Extra fields on an opaque direct capability input remain part of its original input digest but are not execution overrides. Do not invent their effects or mix them into the concatenate-command body; exposing additional effective-policy context would require a distinct typed presentation slot.

### 4. Exact proposed payload and canonical-byte rules

Keep the base Approval presentation revision at 1 and keep all existing limits. Add a Shared-defined optional property after sections:

    commandDisclosure?: {
      revision: 1;
      complete: true;
      encoding: "visible-escapes";
      reconstruction: "section-field-concat";
    }

Revision 1 of this marker means policy-A complete masking/escaping plus the following reconstruction contract:

    presentation.sections
      .flatMap(section => section.fields.map(field => field.value))
      .join("")

The reconstruction literal explicitly specifies outer section-array order, then inner field-array order, and an empty join separator. The encoding literal plus revision pins the visible-escape table below. There are no classification/note fields inside a marked presentation. Titles, labels, risk copy, and any explanation live outside the reconstructed values. All marked fields belong to the command. Labels are not chunk IDs. This avoids a second command string, index lookup map, chunk offsets, and label-based guessing.

The marker is the typed command-disclosure signal. Core requires it for an exec ask; Desktop and CLI use its presence/type to select reconstruction. They do not detect command text from capabilityLabel, section.title, or translated text. Using the canonical capability identity to require the marker at the trust boundary is separate from inferring chunk content.

Suggested Shared surfaces:

- APPROVAL_COMMAND_DISCLOSURE_REVISION = 1.
- ApprovalCommandDisclosureSchema: strict literal object above.
- ApprovalPresentationSchema: optional marker with no default, no transform, no trimming.
- A small reconstructApprovalCommand(presentation) helper may return undefined when unmarked; when marked it performs the exact join above.
- Conditional validation for marked command values enforces both UTF-16 length <= 500 and encoded UTF-8 length <= 500; reject lone surrogates. Keep unmarked legacy presentation semantics intact.
- Export these through the existing named Approval facade/package exports.

Rust mirror:

- Add a strict HostCommandDisclosure struct with matching declaration order: revision, complete, encoding, reconstruction.
- Add command_disclosure: Option<HostCommandDisclosure> after sections, with camelCase rename, default omission on decode, and skip_serializing_if = Option::is_none on encode.
- Validate every literal value and existing byte bound. A marked command body must be nonempty and fully representable under the existing limits.

Canonical requirements:

- Preserve the domain, revision, field order, and existing optional omission behavior in canonicalCapabilityChallenge / canonical_challenge.
- The marker is nested inside presentation, so it is automatically covered by the existing challenge hash. No change to the control or remembered-scope hash is needed.
- Absent marker serializes as absence, never null, false, an empty object, or a default revision.
- Shared parsing and Rust serialization must place the new optional key in the same order when present.
- Keep the current screenshot golden control digest c07a2ba3eb72bc8b068c2c388bfee0dc7c9d9a07d1c26ab52ac5573420ffe0e1 and challenge digest 2ae3935fdee2150a2701f5c3730931753012e7dd833c8e2d3d903196d7dde97e byte-for-byte.
- Add a distinct command fixture with the marker rather than rewriting the legacy screenshot fixture to hide drift.
- APPROVAL_DISCLOSURE_REVISION / disclosureRevision / ApprovalDisclosureAck are the existing future-background-use consent contract. Do not reuse or bump them for command display.

### 5. Recommended compatibility adapter

#### 5.1 Explicit new operator support, not execution capabilities

Add approvalCommandDisclosureRevision?: 1 to ConnectParams and ConnectResult. It is operator-only, optional for legacy clients, and not an execution capability. Store the selected value in the authenticated physical Connection state; echo it only when the client offered the supported value. Omission never implies support.

All connect authentication branches must propagate the same identity/result:

- Token and pairing branches already use authenticatedIdentity/connectedResult (connect.ts:79-91).
- Loopback auto-trust currently bypasses them (connect.ts:98-102); update that branch too.
- Preserve token verification order, loopback checks, pairing rules, and empty operator capabilities.
- Store no new durable device capability or user preference. A reconnect must advertise again; one window's support does not cover another physical connection.

New Desktop requests this support in operator-auth.ts. Its handshake must carry the echo through the ConnectOutcome success branch. Check the requested/selected revision in handshake before returning ok:true, so ws-client.ts:261 does not start timing sync on an incompatible connection. If a requested revision is not echoed, return a fixed readable local compatibility failure with code: null, and let the existing connection-generation controller retire/close the candidate. Do not use AUTH_FAILED: connection-generation-controller.ts:179-187 would clear a token and retry authentication.

Example local message: "Core 版本不支持完整命令审批，请更新 Core 后重试。"

Update the maintained CLI in this slice so its interactive exec path remains usable: advertise in main.ts:68, verify the echo in chat-client.ts:144, and use exact typed reconstruction in approval-prompt.ts:15. These are the three bounded CLI production seams. Old CLI binaries remain legacy operators and receive the explicit unsupported result; no binary may advertise the revision before its renderer and handshake both support it.

#### 5.2 New Core receiving old Host / old operator

Keep the Host challenge schema capable of structurally parsing an unmarked revision-1 presentation. After provenance/control/digest/evidence checks, and before bridging an exec ask:

- Missing command marker: settle the Core pending request as DENIED with a fixed update-Host message; notifyHostCancel with approval_invalidated; return a bounded rejection such as the existing unsupported_version reason.
- Marker present but initiating operator did not negotiate the revision: settle DENIED with a fixed update-operator message; notifyHostCancel; do not create or notify any Approval request.
- No initiating operator: retain the existing APPROVAL_REQUIRED behavior rather than treating this as a display-version problem.
- Non-exec and auto preflight retain existing behavior and do not require this marker.

Perform these checks before ApprovalInteractionService.request / prepareHostWaiting / intent creation. The failure is known to precede execution, so it must not be reported as outcome_unknown. No old operator receives a payload its strict schema cannot parse.

#### 5.3 New Host receiving an old Core's rejection

The current Host already sends capability.challenge as a JSON-RPC request (ws_client.rs:678), but dispatch ignores success/error frames (lines 225-229). An old strict Core rejects the optional presentation property and the Host currently waits until timeout. Complete that existing RPC path; do not downgrade or resend a classification-only presentation.

Use an explicit challenge-specific string ID:

    challenge:<requestId>:<challengeId>

Use this correlated ID for the new marker-bearing exec ask. Unmarked auto/non-exec preflights can retain their existing numeric request IDs and behavior; they need no D64 support negotiation.

This does not require a new protocol method or mapping table:

- Rust JsonRpcId::Str already exists (protocol.rs:79-85).
- Core returns the exact request ID in success and INVALID_PARAMS responses (method-registry.ts:96,120).
- Parse the bounded fixed prefix and two UUID components, find pending_challenges[requestId] in the current HostSession, then compare the challengeId exactly.
- Matching requestId alone is insufficient: a late ACK must not retire a later challenge if a request ID is ever reused.
- Numeric legacy/catalog/respond ACKs, malformed IDs, unrelated IDs, unmarked pending slots, and missing pending slots remain no-ops.

ACK state rules:

| Incoming event | Required behavior |
| --- | --- |
| Matching accepted:true | Reception acknowledgment only; never execute, authorize, consume, or change the sealed command. |
| Matching rejected HostFrameAck | Atomically terminate the still-pending challenge with a fixed sanitized DENIED response. |
| Matching JSON-RPC error or malformed ACK result | Same denial/cleanup; never echo or log the peer's message, data, issues, or result. |
| Repeated success ACK while still pending | No additional transition. |
| Repeated rejection after terminal settlement | No slot remains; no duplicate response/audit/execution. |
| ACK after consume/resume/execute/cancel/expiry | No slot remains; it cannot cancel an executing operation or recreate a prompt. |
| Old challengeId with same requestId | Ignore; it cannot affect the new slot. |
| ACK delivered to a later connection generation | The later HostSession has no corresponding old slot; never use a process-global lookup. |

Register the sealed pending challenge before sending the request. Complete ACK failure retirement under one session lock: compare identity, construct the terminal from the stored exact control/evidence, clear the pending record and active attempt, and insert the existing terminal cache entry. Send the response only after releasing the lock.

An acceptable helper is complete_challenge_failure(request_id, challenge_id, fixed_reason) -> Option<CapabilityRespond>. It must consume/clear the raw-input slot as well as call complete. Alternatively fix complete to clear the matching pending record only after exact active binding validation; cover that behavior with tests. Do not rely on today's complete alone.

Surface a fixed message such as "Core 无法接受完整命令审批，已拒绝执行；请更新 Core 后重试。". The Host does not change its connect version, re-pair, or delete a token for this failure. send_challenge should also return send failure instead of silently swallowing it; clear local state on failure. If the socket is gone, remote settlement still depends on the existing disconnect/deadline lifecycle and must not be claimed as acknowledged delivery.

#### 5.4 Compatibility matrix

| Core | Host | Operator | Result |
| --- | --- | --- | --- |
| New | New | New and echo verified | Full marked command approval, unchanged one-shot resume/audit. |
| New | Old v3 | New | Old classification-only exec ask is denied and cancelled before prompting. Non-exec remains usable. |
| Old strict v3 | New | Old | Extended ask is rejected; correlated ACK/error handling sends a sanitized terminal denial promptly, without touching pairing. |
| New | New | Old / no revision offered | Core settles a readable unsupported-operator denial; no unknown-field prompt is sent. |
| Old | Any | New | Missing display-support echo prevents client promotion; explicit compatibility error. |
| New | Any | No operator | Existing unattended APPROVAL_REQUIRED behavior. |

This matrix is grounded in the current v3 strict schemas. It is not a promise about arbitrary historical binaries or a dishonest authenticated peer claiming support it does not implement.

#### 5.5 Why a bare v4 bump is not the recommended patch

Host negotiation is real: shared/host-control-schema.ts:18 pins v3, Rust host_control_protocol.rs:9 mirrors it, and connect.ts:115-127 selects one supported version before minting credentials. A coordinated v4 cutover could refuse all v3 Hosts early, but:

- Core currently represents version mismatch as AUTH_FAILED (connect.ts:121).
- Rust maps every error except PAIRING_REQUIRED to AuthFailed (ws_client.rs:513-517).
- AuthFailed deletes the stored pairing token (ws_client.rs:133-135).
- It would disable unrelated old Host capabilities and still would not negotiate operator presentation support.

Therefore changing version constants alone does not meet the promised compatibility behavior. Making v4 honest requires a separate credential-preserving compatibility error/lifecycle treatment, including old-Core behavior. The narrow ACK adapter avoids that work and avoids a D77/general-auth-taxonomy expansion.


## Companion disclosure and validation contract

Read [sections 6-11: masking, escaping, bounds, settlement, tests and ownership](d64-disclosure-validation-2026-09-06.md) together with this file. The split keeps both complete documents within Trellis context injection bounds; it changes no recommendation.
