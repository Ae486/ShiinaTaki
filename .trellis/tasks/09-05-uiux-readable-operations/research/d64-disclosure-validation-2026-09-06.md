# D64 disclosure rules, verification and ownership

Companion to [the executable source and compatibility contract](d64-executable-contract-2026-09-06.md). Main split the completed research at section 6 for complete Trellis context injection. Read both documents; section numbers and recommendations are retained.

### 6. Deterministic masking from the sealed raw command

#### 6.1 Existing helpers and dependencies

| Source | Usable part / limit |
| --- | --- |
| capabilities_impl/exec.rs:59 | command_of extracts exactly input.command; no parsing or normalization. |
| capabilities_impl/exec/parser.rs:33-99 | Quote/whitespace model is evidence for what the current executor sees. Its argv output discards source offsets/quotes and must not be used to reconstruct the display. |
| capabilities_impl/exec/sandbox.rs:35-57 | Scrubs inherited environment for execution only; it does not redact command strings. |
| packages/core/src/perception/pii-scrub.ts:21-23 | Existing observation masker retains head/tail fragments and is unsuitable for D64. |
| packages/core/src/perception/pii-scrub.ts:80-119 | Finite vendor-prefix, JWT, URL-userinfo, and private-key recognition classes are useful references; do not copy the partial-mask behavior or bounded-prefix tail leakage. |
| apps/desktop/src-tauri/Cargo.toml | Direct std/serde/serde_json/sha2/time/uuid support is sufficient for a pure scanner. No direct regex, URL-parser, shell tokenizer, zeroize, or secrecy dependency is declared. |
| apps/desktop/src-tauri/Cargo.lock:3548 | regex 1.12.4 is transitive, not a callable direct dependency without a manifest change. |
| Cargo.lock:4014,4020,5184,5196,6382 | shlex 1.3.0/2.0.1, unicode-segmentation 1.13.3, url 2.5.8, zeroize 1.9.0 are transitive. Presence does not authorize a new direct dependency or establish a D64 helper. |

Use a separate pure Rust disclosure module. Do not spawn commands, expand environment variables, resolve paths, read files, query credentials, parse with a shell, normalize URLs, or add a TypeScript execution parser.

The current execution parser removes quote delimiters and treats backslash as an ordinary Windows path character even inside quotes. Its unknown/complex cases still fail in sandbox::run after approval. Common credential detection in such text is display behavior only; it does not make leading env assignments, shell expansion, compounds, or new syntax executable.

#### 6.2 Initial recognition contract

Recognizers select byte ranges in the original string. Replace the complete sensitive range with a fixed purpose marker, never a value-derived prefix/suffix. All bytes outside selected ranges survive in their original order until visible escaping. Retain surrounding delimiters/quotes when their boundaries are unambiguous.

| Recognized context | Required complete masking |
| --- | --- |
| Long options, e.g. --token VALUE, --api-key=VALUE, --password="VALUE WITH SPACES" | Whole next logical value or whole assignment value, including any attached/concatenated value fragments. A value beginning with a dash is still the value when explicitly attached by '='. |
| Credential assignments, e.g. TOKEN=VALUE, API_KEY="VALUE", AWS_SECRET_ACCESS_KEY=VALUE; env/set/$env: forms as text | Whole credential value. Match a finite case-insensitive key set and declared suffix families, not arbitrary "key" substrings. No env expansion. |
| Authorization / Proxy-Authorization / X-Api-Key headers | Whole credential portion, including Bearer/Basic payload; retain a nonsecret scheme label only when recognized. |
| Cookie / Set-Cookie headers | Whole header value, so separators or spaces cannot expose a later cookie credential. |
| URI userinfo and credential query parameters | Whole userinfo credential range and whole recognized query value; keep scheme, host, port, ordinary path, other query values, and fragment order. Scan raw offsets rather than reserializing through a URL library. |
| Known vendor-token prefixes and JWT-like tokens | Entire maximal recognized token/value, not a fixed-length prefix. Long values must not leak after a 512/4000-character detection ceiling. |
| PRIVATE KEY blocks | Whole body/block through its matching end; an unterminated recognized block fails disclosure instead of exposing the remainder. |
| curl credential option aliases, if supported | Only aliases tied to the actual recognized program/context. A universal '-p' or '-u' rule would mask ordinary port/update/path arguments in other programs. |

Selected initial key matching: remove syntactic option/assignment wrappers, ASCII-case-fold the key, and compare hyphen/underscore-insensitive exact names password/passwd/pwd, token/access_token/refresh_token/id_token, api_key/apikey, secret/client_secret/secret_key/secret_access_key, authorization/proxy_authorization, cookie/set_cookie. Credential headers additionally recognize X-Api-Key. Environment names also match the underscore/hyphen-delimited suffixes PASSWORD, PASSWD, TOKEN, SECRET, API_KEY, ACCESS_TOKEN, REFRESH_TOKEN, CLIENT_SECRET, SECRET_KEY, and SECRET_ACCESS_KEY; a bare KEY suffix is not included. Strip a recognized $env: wrapper for name matching only. A terminal FILE or PATH segment remains a path-purpose exclusion. These comparisons never rewrite the displayed key. Freeze this finite table and its exclusions in tests; new families require an explicit contract update rather than a broad substring regex.

Ordinary --file/--config/--output values, *_FILE/*_PATH assignments, workspace directories, drive paths, UNC paths, user names, and arbitrary data text are not credential values merely because they are paths or contain a word such as "key". A path intentionally used as the value of an explicit password/token argument is a credential-context exception. Do not import perception's general email/phone/card minimization into policy A.

Use the same quote boundaries as the current executor for supported forms, while keeping source byte offsets. In particular, do not reinterpret backslash as a POSIX escape. If a recognized credential's complete boundary is ambiguous (unterminated quote, malformed known header/value envelope), return a fixed disclosure failure. Unrecognized arbitrary syntax is still displayed under A; this is not policy B's general supported-command allowlist.

Important vectors include quoted spaces, quote fragments adjacent to unquoted suffixes, '=' padding, colon-bearing values, repeated options, mixed key casing, token-like path components, URL userinfo, percent-encoded credential query keys where explicitly supported, and credentials straddling a would-be chunk boundary.

#### 6.3 Escaping, resource bounds, and chunking

Apply recognition/masking before chunking. A detector must never operate separately on 500-byte slices.

The escape projection must distinguish a literal escape-looking sequence from a real control character. A suitable deterministic convention:

- Literal backslash -> doubled backslash.
- LF/CR/TAB -> visible \n / \r / \t.
- Remaining C0/DEL/C1 controls, including ESC -> explicit \u{XXXX}.
- Bidi controls U+061C, U+200E/U+200F, U+202A..U+202E, U+2066..U+2069 -> explicit code-point escapes.
- Also escape U+2028/U+2029 and the selected invisible format set, e.g. U+00AD, U+200B..U+200D, U+2060, U+FEFF. Freeze the table in tests.
- Keep ordinary printable Unicode and ordinary path characters visible; do not normalize Unicode or replace a path with its basename.

The complete command is the escaped projection, not an executable/copy-back raw string. Use short Chinese copy explaining that recognized credentials are hidden and controls are shown as escapes. Never say that all secrets were detected.

Proposed implementation envelope:

1. Scan borrowed raw spans with fixed recognizers/quote state; avoid reconstructing argv or allocating a second unbounded raw string.
2. Consume a whole recognized credential range before emitting its fixed marker. Resolve overlaps deterministically; masking must never reveal an already recognized span.
3. Emit scalar/escape/marker atoms into an output bounded by the existing presentation capacity. Work must be linear in the already received input, with a fixed recognizer count; avoid nested backtracking or rescanning unterminated prefixes.
4. Append an atom only if the current chunk remains <= 500 UTF-8 bytes AND <= 500 UTF-16 units. Split only between valid Unicode scalars and preferably between escape/marker atoms.
5. Pack nonempty chunks in order, <= 12 per section and <= 8 sections. All 96 slots are available to command text because explanations are outside the field values.
6. If a 97th chunk is needed, return PresentationTooLarge. Never emit a partial presentation, replace a tail with ellipsis, or call it complete.
7. Validate static Chinese title/labels/risk text against Rust's byte bounds too, then seal the final validated presentation.

The 48,000-byte figure is an upper bound, not a promise that every 48,000-byte projected string fits: atomic Unicode/escape boundaries can leave unused bytes in chunks. The actual acceptance rule is successful complete packing into <= 96 bounded chunks. A long raw credential may shrink substantially after masking; no new raw-command length cap was found in exec-tool.ts:23. Do not silently invent one. A fixed-pass scanner plus bounded output can process such input without buffering all matches.

Boundary examples:

| Value before any additional escaping | UTF-8 bytes / UTF-16 units | Required result |
| --- | --- | --- |
| 500 ASCII characters | 500 / 500 | One field. |
| 501 ASCII characters | 501 / 501 | Two fields, complete tail retained. |
| 166 CJK BMP characters | 498 / 166 | One field. |
| 167 CJK BMP characters | 501 / 167 | Split despite passing the TS length limit alone. |
| 125 emoji outside the BMP | 500 / 250 | One field, no surrogate split. |
| 126 such emoji | 504 / 252 | Split at a scalar boundary. |
| 250 such emoji | 1000 / 500 | TS-only max would pass; producer/marked schema must still enforce byte bounds. |
| Exactly 96 packed ASCII chunks / one extra atom | At most 48,000 / then overflow | Full success / immediate denial respectively. |

### 7. Host build-failure settlement and proposed signatures

Suggested signatures are recommendations, not existing APIs:

    project_exec_command(raw: &str)
      -> Result<HostChallengePresentation, CommandDisclosureError>

    build_challenge(host_id, evidence: &HostGovernanceEvidence, request, descriptor)
      -> Result<CapabilityChallenge, ChallengeBuildError>

    challenge_rpc_id(request_id: &str, challenge_id: &str) -> String

    complete_challenge_failure(request_id, challenge_id, fixed_reason)
      -> Option<CapabilityRespond>

Use finite errors such as EmptyCommand, AmbiguousCredentialBoundary, PresentationTooLarge, InvalidPresentation. Errors must not contain raw matched text, a quoted command, token fragments, a source slice, a serde debug dump, or an arbitrary peer error. Borrowing evidence lets the caller retain it for a failure response rather than accidentally fabricating a new posture.

Replace ws_client.rs:288-291 with:

1. Construct CapabilityRespond::err using the exact requestId/control, CapabilityErrorCode::Denied, and a fixed short Chinese message.
2. Attach the original preflight evidence with with_governance. Do not use default_for as a substitute for trusted ask evidence or invent a new policy decision.
3. Complete the active attempt under the session lock and send the returned terminal response immediately.
4. Store no pending challenge on build failure; create no Approval, resume, execute, or new audit call.
5. Log at most request ID and finite failure category. Existing log_terminal already logs only capability/result/code.

A failed terminal with the original ask evidence and no authorization is valid under capability-response.ts:43-76. It settles as DENIED before any effect; it is not an execution failure of unknown outcome.

After a stored challenge's ACK failure, the same response shape applies, but the raw pending slot must also be retired. Parent main/check must verify no second response is emitted when cancel and reject-ACK race.

### 8. Desktop and CLI presentation behavior

For commandDisclosure present, reconstruct all chunks with the Shared typed helper and render one literal selectable monospaced text block. Preserve whitespace, support wrapping or scrolling, and make the scroll container keyboard accessible. Use React text content, not HTML/Markdown evaluation or clickable-shell links.

Do not display chunk labels between values; they are transport grouping only. Do not add source newlines at chunk/section boundaries. The transformed command is complete when the final tail is visible/reachable. No line clamp, CSS ellipsis, height clipping without scroll access, token/digest inspector, or raw data attribute.

Keep the current dialog/controller's choice, expiry, queue, generation retirement, and future-background-use acknowledgement behavior. The rendering branch is the typed marker, never a Chinese title. A semantic guard may reject an exec request lacking the required marker; it must not guess command fields from that request.

An updated CLI renders the same joined projection as literal text, with decoration only before/after the whole command. The escape contract removes terminal-control/Bidi payloads before that point. It must not advertise support merely because a generic field list can print some text.

### 9. Test plan and exact seams

| Seam | Required evidence |
| --- | --- |
| New pure Rust disclosure module | Table-driven whole-value masking for header/URL/long-option/env cases; unknown text and ordinary paths retained; no prefix/suffix leakage; adjacent quote fragments and repeated credentials; no execution/I/O. |
| New module boundary tests | 499/500/501 ASCII, CJK, emoji, combining text, CR/LF/TAB/ESC/Bidi, literal backslash-plus-n vs newline, lone-surrogate rejection on TS side, full last chunk, 96/97 chunks, post-escape overflow, a secret crossing a former chunk boundary. |
| New module resource tests | Long recognized tokens/private-key blocks have bounded output and no leaked remainder; unterminated recognized values fail; no catastrophic backtracking or repeated rescans. |
| shared/approval-schema.test.ts | Optional marker strictness, literal values, UTF-8/UTF-16 limits, exact reconstruction, no default injection into legacy payloads. |
| shared/host-approval-schema.test.ts:74 and Rust host_approval_protocol.rs:385 | Preserve old canonical hashes/bytes; add a shared command fixture and compare hashes in both languages. Changing marker, chunk text/order, trailing content, title/risk, or scope invalidates the challenge digest. |
| Rust ws_challenge.rs:141 | Build from exact exec input; full permitted command reaches the sealed presentation; recognized credentials do not. Keep the existing screenshot raw-input privacy test. |
| Rust ws_challenge.rs:175 | Different raw credentials with identical masked presentation still produce different input/control/challenge digests. An authorization for A cannot resume B. Existing generation/ID/digest/expiry rejection remains. |
| Rust ws_client.rs:802 | Preflight has no executor access; successful full disclosure does not itself execute. Build failure completes immediately, emits one bounded DENIED, stores no challenge, and does not audit raw input. |
| Rust HostSession tests at 321,334,557,587,616 | Exact duplicate terminal reuse, duplicate in-flight suppression, single consume, cancellation cleanup, and fresh reconnect session remain. Add terminal completion clearing the exact pending raw slot. |
| New Rust ACK tests around dispatch / session helper | Real string-ID correlation; malformed/unrelated/numeric ACK ignored; old challengeId cannot terminate reused requestId; accepted ACK never executes; duplicate reject emits one terminal; late ACK after resume/cancel/complete does nothing; no raw peer error text appears in response/logs. |
| Core capability-challenge.test.ts:42,179,283,359,405 | Add exec-specific harness, marker validation, old-Host refusal, old-operator refusal, no prompt/resume/intent on either failure, existing timeout/deny/provenance/tamper behavior, sanitized logs. Do not weaken screenshot coverage. |
| Core capability-response.ts tests / broker tests | New failed response is accepted with exact ask evidence and no authorization; wrong control, generation, or authorization is still rejected. |
| connect-schema.test.ts / core connect.test.ts | Operator-only field; capabilities still empty; node offer rejected; omission means legacy; all token/pairing/loopback success paths store/echo negotiated revision. Preserve current auth ordering and no durable state from incompatible Host negotiation. |
| Desktop operator-auth.test.ts / ws-client.test.ts | Offer and echo survive the handshake; missing echo yields visible code:null compatibility refusal, closes candidate, and does not clear credentials or start restoration/timing sync as a successful connection. |
| Desktop approval-dialog.test.tsx:31 | Typed command branch, exact joined textContent including tail/whitespace, no chunk-label insertion, readable scroll access, no marker/digest/version exposed to the operator, unchanged buttons and acknowledgement behavior. |
| Desktop approval-dialog-controller.test.ts | Existing duplicate/late/expired/replaced-client responses remain single-use; no new approval cache/persistence. |
| CLI chat-client / approval-prompt tests | Strict parse remains; negotiate only after full renderer support; verify echo and exact join; old CLI fixture receives no new marker-bearing prompt from new Core. |
| e2e/src/approval-challenge-resume.e2e.test.ts:20 | Change the obsolete classification-only assertion at lines 32-33: permitted command content is now visible. Retain exactly one resume, one raw approved-exec audit row, and no diagnostic sentinel. Add synthetic credential masking plus unchanged raw audit. |
| Same e2e file:54,81 | Operator deny and no-operator paths execute nothing and add no raw audit. Add over-capacity/ambiguous disclosure and old-peer failures that settle well before the configured approval deadline. |
| e2e/src/fixture/operator-drivers.ts:38 | Updated positive-path operator fixture must advertise/verify the new revision; retain an explicit legacy fixture for compatibility tests. |

The current ws_client RecordingAudit at lines 758-765 discards its command argument. Enhance that test double to retain the optional command for the audit-preservation tests; the current screenshot-only assertions cannot prove original-command preservation.

For the identical-masked-display test, pin requestId, challengeId, timestamps, generations, and all other control fields; vary only the raw credential value and its correctly recomputed inputDigest. Otherwise randomly different IDs could make the hash assertion pass without proving that raw-input identity remains bound.

For the old-Core/new-Host test, a narrow mocked Core may strict-parse the legacy presentation and return INVALID_PARAMS using the exact request ID, then accept the Host's ordinary failed terminal. Assert no handshake retry or secret-store delete. A full second historical checkout is not necessary for that executable contract.

Run relevant Shared/Core/Desktop/CLI tests plus Rust tests and clippy after implementation, then required workspace gates. This research did not run implementation tests or claim manual UI acceptance.

### 10. Bounded production ownership for implement/check

| Owner area | Proposed files and responsibility |
| --- | --- |
| Shared protocol | approval-schema.ts; host-approval-schema.ts only for necessary validation/canonical integration; connect-schema.ts; approval-api.ts and index.ts named exports. Add metadata/reconstruction and the narrow operator handshake field. |
| Rust pure adapter | New src-tauri/src/exec_command_disclosure.rs, with a colocated private submodule only if scanner responsibility needs separation; lib.rs registration. No edits to exec parser/policy/sandbox. |
| Rust protocol and lifecycle | host_approval_protocol.rs; ws_challenge.rs; ws_client.rs; host_session.rs for exact failure retirement/cleanup. Keep Host control protocol/catalog versions and classifier revisions unchanged under the recommended ACK strategy. |
| Core compatibility | server/connection-registry.ts; server/methods/connect.ts; capabilities/capability-challenge.ts. Existing methods/capability-challenge.ts changes only if needed for a bounded ingress guard. No new Approval authority or persistence. |
| Desktop consumer | lib/operator-auth.ts; lib/ws-client-methods.ts; lib/ws-client.ts only where success promotion/timing must honor negotiation; components/approval/approval-dialog.tsx or a small extracted command component. Controller changes only for explicit malformed/unsupported presentation refusal. |
| CLI parity | main.ts; chat-client.ts; approval-prompt.ts are included in the selected slice: advertise/verify the revision and render the exact typed joined command. Retain a legacy-client fixture to prove immediate refusal for old binaries. |
| Tests/fixtures | Colocated tests above; one new Shared command golden fixture; e2e approval-challenge-resume test and operator-drivers fixture. |
| Index/spec maintenance | Update touched directory index.md files and changed module-contract headers. Main owns spec/task decision synchronization; this researcher wrote none of those files. |

Avoid changes to D63 execution semantics, Governance/Approval decision keys or generations, database schemas, Compaction/A1/A2, Monitor/DSH, secret-catalog storage, or general connection retry policy.

### 11. Related specs and references

- .trellis/workflow.md: current-source/task research persistence and sub-agent responsibilities.
- .trellis/spec/guides/source-grounding-guide.md: source-first gap resolution.
- .trellis/spec/guides/cross-layer-thinking-guide.md: explicit producer/protocol/consumer and compatibility contracts.
- .trellis/spec/backend/permission-authorization.md:186-187: sensitive command/control data excluded from ordinary logs; dedicated exec audit exception.
- .trellis/spec/backend/host-operation-lifecycle.md: exact request/provenance, bounded terminal caches, schema parity, no replay after generation loss.
- .trellis/spec/backend/server-push-and-connection-auth.md: operator-only channels, physical connection ownership, auth versus governance versus Host enforcement.
- .trellis/spec/backend/quality-guidelines.md and frontend/component-guidelines.md: pure bounded concerns, meaningful security-boundary tests, existing UI primitives.
- docs/adr/0002-exec-in-v1-behind-permission-gate.md; docs/adr/0004-jsonrpc-ws-protocol-with-pairing.md: execution locality and existing transport/auth foundation. Current code overrides their older lifecycle descriptions.
- Task research/d64-disclosure-policy-proposal-2026-09-05.md: policy A is now adopted; no remaining owner-choice blocker.
- External references: no network/API research was needed. Dependency/version facts come from the installed project's Cargo.toml/Cargo.lock: Rust MSRV 1.95, serde_json 1.0.150, Tauri 2.11.5, plus the transitive inventory above. The proposed implementation uses the same std/serde mechanisms already present rather than an unverified external API.

## Caveats / Not Found

- No reusable complete Host command redactor or operator presentation negotiation exists in the inspected code. Both are new, bounded D64 work; never describe either as an existing feature.
- The supplied gate/exec_class.rs path is stale; the current definition is gate.rs:28.
- The selected credential-name/suffix table, quote boundaries, and overlap handling must be frozen in implementation tests. The recognition envelope above deliberately cannot identify every arbitrary secret. Unknown text remains visible under the selected policy.
- Presenting a complex command is not proof it can execute: current sandbox reparses and refuses Complex. Environment-assignment recognition is redaction, not environment-setting functionality.
- Complete's missing pending cleanup and ignored challenge ACKs are real current lifecycle gaps relevant to this adapter. Do not claim that adding only a display helper resolves them.
- A bare Host v4 bump would trigger current token deletion on version refusal; use the recommended ACK strategy or explicitly include the larger auth compatibility repair.
- Existing canonical metadata limits still have byte/unit differences for unmarked legacy content. Enforce both for new command disclosure without silently migrating legacy digests.
- Legacy old-operator/Core behavior is supported only through explicit refusal described above; there is no marker-stripping or title-based downgrade.
- Dropping Rust Strings/Values does not securely erase their backing memory. No secure-zeroization claim is made.
- Current artifacts changed concurrently under main's ownership; all source anchors here reflect read-only inspection on 2026-09-06 before D64 implementation. Main should update any moved anchors when committing the final contract.
- Only this research file was written. No production files, specs, task lifecycle, Git state, or memory files were changed; no implementation tests/manual acceptance were performed.
