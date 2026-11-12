# Explicit Co-Watching integration — 2026-10-15

Status: implementation in progress after owner approval of the sequence described below. The owner continues
without Trellis task creation/binding. R7's native functional acceptance and all preceding evidence stay immutable.

## Observable delivery

Connect an explicitly selected browser video and real user acceptance to the existing accepted-work/prepared-output
owners. Then use the ordinary Agent/Skill and independent native MCP tools to prepare optional Character output,
publish against current playback, revise future output during conversation, and Stop without late publication.
Existing M01–M59 remain authoritative. Detected/recommended entries, OpenBili browsing and full restart/Continue
follow this first explicit path; this sequence does not mark them completed or remove them from scope.

## Implementation sequence

1. Add a bounded playback-source receiver to the existing Perception layer and strict Shared/Rust wire contracts.
   Reports enter only from a current authenticated Node with its current catalog. Core assigns source references;
   browser payloads cannot supply Host identity, Core connection generation, consent or publication authority.
2. Add an optional local Shell attachment and a small module in an isolated, traceable OpenBili extension checkout.
   The extension reuses its browser/platform environment and sends one explicitly selected source. It gets a
   dedicated local attachment credential, never a Core operator or Node credential. Host communication continues
   through the paired Shell. Raw pages cannot access the attachment credential or select another tab's identity.
3. Connect explicit acceptance, exact media/result identity and current playback to the existing business adapter
   and generic prepared publication. Keep task content/Skill helpers outside generic Harness rules. Reuse existing
   Run/Attempt, governance, foreground queue, cancellation and Timeline owners.
4. Exercise this composition with stored native results and deterministic fixtures, then package the actual Shell
   and extension for the owner. Only then request the bounded browser actions needed for real playback acceptance.
5. Validate actual native/Agent use, at least two outputs, conversation/revision, Stop, seek/rewind, source replacement,
   disconnect and late callbacks. Record every Agent/Harness behavior change and preserve separate Heartbeat gates.

## Playback source contract

- Observation is optional and disabled by default in Core and the local attachment. Enabling source observation is
  an operator action; it is not Co-Watching acceptance and does not grant tool permissions or start inference.
- The selected tuple contains attachment generation/identity, tab, frame, browser document, player and exact
  Bilibili BV/CID/page. Core additionally retains the actual authenticated Host/socket/catalog generations.
- The Shell supplies a monotonic attachment generation per Core connection and increasing sample sequence.
  Replaced, retired, expired or mismatched bindings cannot reopen under their old identity. A fresh attachment
  creates a new source reference, which cannot silently replace the source of accepted work.
- Position, duration and rate are finite values or explicitly unknown. Playback state, visibility and PiP are
  observations, not proof that the user understood content. Page text is never included in trusted instructions.
- Receiver freshness uses Core reception time and bounded reported age, never a page wall-clock timestamp.
  The initial 1-second source cadence / 5-second receiver freshness are explicit engineering starting values to
  measure during browser acceptance. Expiry, privacy disable and connection/catalog retirement invalidate output.
- Paused/buffering/seeking/hidden-without-PiP sources withhold timed output. Forward seeks do not produce catch-up
  speech. A browser tick creates neither an Agent turn nor a Timeline row. Consumers reuse publication guards.
- One source is retained per current Host connection; no browser-history database, second execution ledger,
  recommendation scorer or Co-Watching-specific model loop is introduced.

## Verification and owner boundary

Source tests must cover wrong roles/socket generations/catalogs, reversed sequences, old attachment replay,
tab/document/player/part changes, nonfinite values, stale age, expiry, disable, disconnect, and caller mutation.
Shared/Rust fixtures must agree. Shell tests use real local transport and exact cleanup without real profiles.
Existing permission and publication regressions remain required for any changed owner.

The existing Edge process is a normal profile without remote debugging. The intended live path is the extension,
so no browser restart, remote-debugging switch, real-profile edit or credential export has been performed.
The owner was asked only whether Edge already has OpenBili and whether the daily Shell/Core are paired. Offline
implementation can proceed while that environment information is pending. Installation and manual acceptance
instructions will name concrete built artifacts, with the existing extension/profile preserved.

## Current evidence

- Workspace: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`; 805 pre-existing status entries.
- Semantic search returned an older main revision; all used hits were checked against current T4 files.
- The context-explorer service was unavailable; research continued through local search and direct source reads.
- No new provider request, deployment, task lifecycle action or commit is part of the research above.

## Installed validation setup and continuation

- Owner confirmed importing the development extension and completing Shell/Core pairing.
- The isolated Core uses `ws://127.0.0.1:8974` and `core-profile/` under
  `.runtime/media-implementation-20261015-playback/`. The Shell uses the sibling `shell-profile/`, a separate
  keyring service and loopback attachment `ws://127.0.0.1:18793/taki-browser`.
- The validation-only Tauri config now opens Home directly at `home.html?page=perception`. Production window
  topology and legacy pairing UI are unchanged. Restart preserved the paired Shell Host and advanced its connection
  generation from 1 to 2. Local pairing credentials are user-revealed and copyable in the Home card only.
- Browser manipulation remains manual at the owner's request. The owner was given Edge extension-details/options
  steps and the explicit test video `BV1UEaq6qEZt?p=1`. The latest Core check still has observation disabled and zero
  sources; do not infer successful browser connection or acceptance from installation/pairing.
- The running Shell was built before the subsequent wire-preserving boxed-enum/callback cleanup. Those source
  changes pass clippy and native tests but are not yet loaded in the currently running application.
- Current test evidence: Desktop 1,187; Core source/config 23; Shared 15; native library 203 and helper 7 passed.
  The first native full suite caught an outdated exact Home ACL assertion, now corrected with actual compiled
  authority checks proving browser setup/pair remain Home-only and unavailable to remote origins.
- The extension full Windows suite has eight unresolved upstream harness/static-source failures (1,385 pass).
  Its two new capture tests pass. See the H22/H23 implementation record for the exact limitation.

Pending next: actual source identity/freshness/privacy/navigation/disconnect observations, followed by a trusted
accepted producer and ordinary Agent/Skill preparation through the existing bridge. Full Co-Watching is incomplete.

## Current Bilibili player compatibility repair

Owner Console evidence established two independent capture defects: `getVideoInfo()` is absent, and the page has
one main video plus visible recommendation previews. The player's `mediaElement()` returns the main video and
`getElements().videoArea` contains that element only. Actual media input is
`__getUserParams().input` with `bvid=BV1UEaq6qEZt`, `cid=42265479965`, and `p=1`; `getMediaInfo()` only provides
playback statistics. Earlier mocked `executeScript` results did not exercise either defective injected function.

The extension now binds the exact current player element in MAIN, reads its isolated-world UUID and playback
sample, then verifies the same live input and element in MAIN. A fresh non-secret DOM marker joins these reads,
is removed on verification, and schedules five-second cleanup if capture is interrupted. Browser timer throttling
may delay cleanup; capture-age and Core freshness checks remain independent. Cleanup reads no playback data and
cannot remove a newer probe. Only allow-listed media fields leave MAIN;
page initial state, media URLs, tracking metadata and user details are not exported or used as identity fallbacks.
The selected URL, part, browser document/frame, privacy generation and unchanged Core source guards still apply.

The observed page shape reproduces the original failures in tests that execute actual serialized production
functions in separate script worlds. The same fixture supports validation of functions extracted from the built
background bundle. Repair evidence and exact gate results are retained under
`.runtime/media-implementation-20261015-playback/player-compatibility-fix/`. Real reception after manually reloading
the staged extension remains pending; this repair does not wire acceptance or commentary publication.

### Receiver document-token compatibility

After owner reload, the extension passed authentication and produced a valid playback sample, but the Shell
closed the channel. Temporary field-validity-only diagnostics showed a 32-character browser document ID rejected
by the 36-character UUID check; the extension-minted player UUID, sample and capture age were valid.

Shared/Core and Shell now preserve and accept Chromium's exact 32-hex document token as well as the existing UUID
form. Only `documentId` changes: player/attachment/Host UUIDs, strict object fields, current connection provenance,
part identity and stale-source retirement remain unchanged. No fabricated UUID or lossy identifier conversion is
introduced. A shared raw-token fixture, strict malformed-token tests, Core replacement test and real loopback test
pin both sides of the wire. The diagnostic-only server edit was removed byte-for-byte before the final rebuild.

### Verified live reception — October 16 local continuation

The owner reported normal extension connection and a paused video. Core confirmed one actual source for
`BV1UEaq6qEZt`, CID `42265479965`, paused at 142.613366 / 300 seconds. After removing temporary diagnostics and
restarting the real Shell, reception remained live; the selected page later reported `BV1BTP5euE75`, CID
`28581954126`, paused at 2.987953 / 310 seconds. Browser document/player identity remained intact.

An authorized local operator disable/restore test cleared all sources, then restored one fresh source with a new
reference and attachment generation. Reception is left enabled. Final evidence is in `live-owner-paused.json`,
`live-final-1.json`, `live-reception-disabled.json`, and `live-final-restored.json` under the repair directory.
Shared 17, Core source/config 24, Shell 6, installed-extension 12 targeted tests, typechecks, scoped lint and Rust
all-target clippy passed. Actual paused-source reception and receiver control are now established; complete
play/pause/seek/navigation user acceptance and Co-Watching preparation/publication remain separate work.

### Delegated browser acceptance after reboot — October 16

The owner explicitly authorized computer/browser operation in the continuation of session
`01a13fbf-4fec-73c2-9dc3-3200707262fb`. This supersedes the earlier owner-only browser-operation restriction above.
The restored Core and Shell retain the original isolated profiles. Edge uses a separate validation user-data
directory with the same staged extension; its real Bilibili player is driven through loopback CDP. Pairing uses
the actual Home and extension options UI, with the dedicated token held only in process memory and browser session
storage. No account login, cookie export, synthetic playback sender or model request is needed for these tests.

The 13 real-page assertions passed: initial paused reception, playing advancement, pause propagation, freshness
while paused beyond five seconds, forward seek, play after seek, rewind with stable source identity, immediate
disable retirement, fresh identity after enable, hidden/visible changes, exact same-tab video/document replacement,
and paused reception of the replacement video. Additional live checks cover Shell disconnect/reconnect, Core restart,
browser exit, session-credential loss, and automated re-pairing. Core reports the expected BV/CID and real position.
This is delegated engineering acceptance; it does not assert that the owner personally inspected each interaction.

Three harness/environment findings are retained rather than hidden:

- Tauri dev shutdown also stopped Vite. A direct Shell launch with no frontend server was not a valid reconnect run.
  The restore helper now supervises Vite separately.
- Replacing the original forward-slash Shell profile literal with Windows backslashes selected a different keyring
  namespace because `build_client` hashes the path string. Restoring the original literal restored the paired Host
  and existing extension connection without re-pairing. Product normalization/migration is tracked as T4-D83.
- Edge disabled the command-line-loaded unpacked extension after the first clean restart with developer mode off.
  The agent enabled developer mode through the visible extensions menu in the dedicated test profile, then paired
  again through the trusted UI. No browser preference files were edited.

Evidence lives in `.runtime/media-implementation-20261015-playback/restart-auto-20261016-100418/`, including
`live-playback-results.json`, the named disconnect/restart snapshots and `browser-cold-start.json`.
`resume-validation.ps1` in the parent directory restores missing processes and refuses unrelated port owners;
`pair-browser.mjs` re-pairs after browser exit and verifies the expected extension before supplying its credential.
`live-playback.mjs` repeats the real-page suite from the initial BV1UEaq6qEZt page. Logs and screenshots remain local.

The previous compatibility repair's 16-file hash manifest still matches current source. This continuation changes
test automation and documentation, not those production receiver/capture files. The earlier eight upstream extension
suite failures are not claimed fixed. Source acceptance does not implement explicit Co-Watching consent, native-result
binding, Agent preparation, timed publication, conversation/revision or Stop. The next development seam remains the
trusted producer feeding `co-watching/publication-source.ts` and the existing accepted-work/publication owners.

The final all-process cold-start check also passed via `resume-validation.ps1`: Core, separately supervised Vite,
Shell and Edge restarted from stopped state; developer mode remained enabled; the updated pairing helper verified
the installed extension and restored the original Host without owner input. `final-live.json` records the selected
BV1UEaq6qEZt source paused at 14.894518 / 300 seconds with a new document/source identity; `final-home.png` records
the real Home source display. Running processes at handoff are recorded in `resume-20261016-102902/process.json`.

### Real-model composition follow-up

The subsequent [prepared playback test](MEDIA-PREPARED-PLAYBACK-VALIDATION-2026-10-16.md) passed with the real model,
actual file tools, this live playback channel and R7's stored original native result. It covers two publications,
foreground revision, no replay, expiry and quiescent Stop. Acceptance/snapshot/transport remain controlled fixtures;
the missing production acceptance producer and final desktop delivery are still the next integration boundary.
