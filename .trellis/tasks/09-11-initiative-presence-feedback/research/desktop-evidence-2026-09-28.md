# C2 Desktop and native evidence — 2026-09-28

## Scope and source identity

This report closes the Desktop evidence gap from parent session `01a0dd62-d788-7762-ba7d-c7baab4b5638`.
The completed Desktop/native commands were recovered from its delegated session
`01a0e5c0-8b2b-74f3-adf0-204cbf616a7e`; their exact command, completion time, exit status, stdout and stderr are
preserved in [the prior gate records](desktop-prior-gates-2026-09-28.json). Recovery reads actual command records,
not the previous agent's summary. All paths and current checks are in `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, HEAD `06a8090118a45a8c4f06472be4917108f93aea44`.

The active child is `09-11-initiative-presence-feedback`, explicitly assigned under the native-session workflow.
The unrelated legacy global `.current-task` pointer was not modified. This closeout does not authorize a commit,
push, archive, C3 implementation or owner acceptance.

The audit compared all 895 Desktop and Shared source/configuration entries in
[the pre-final checkpoint](source-before-final-2026-09-28.json) before the test-only correction below: no hash changed.
That checkpoint was captured at `2026-09-28T02:51:24.339388Z`. It is later than the native execution; its hash match
proves current checkpoint equality, not a contemporaneously recorded native-binary hash.

The only later source drift is the three expected permission strings in an existing Rust test described below.
No production behavior or specification correction was required. The independent formal review and earlier Desktop
fixes remain documented in [the formal review](formal-review-2026-09-28.md), especially F2's physical-client source
ownership across React lifecycle replay.

## Preserved native evidence

The successful original run completed at `2026-09-28T02:36:39.312Z` with exit code 0:

```text
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --example c2-presence-fixture --locked
node apps/desktop/test/c2-presence-native-smoke.mjs
```

The fixture build completed at `02:31:41.081Z`; the command record retains its informational MSVC linker-output
warning. The smoke command rebuilt its dedicated fixture assets and ran all eleven assertion groups.

The original build-directory evidence was copied byte-for-byte into this task:

- [Raw evidence JSON](native-evidence/2026-09-28T02-35-50-358Z/evidence.json): 11 completed groups, 86 emitted report
  records and 123 RPC call records; native query diagnostics and empty captured GUI process output are retained.
- [Chat rendering](native-evidence/2026-09-28T02-35-50-358Z/chat-rendered.png).
- [Pet rendering](native-evidence/2026-09-28T02-35-50-358Z/pet-rendered.png).
- [User Timezone settings](native-evidence/2026-09-28T02-35-50-358Z/timezone-settings.png).
- [Retained reading selection and scroll position](native-evidence/2026-09-28T02-35-50-358Z/reading-anchor.png).
- [Artifact sizes, SHA-256 hashes and source-audit manifest](native-evidence/2026-09-28T02-35-50-358Z/manifest.json).

The raw JSON SHA-256 is `ebb146f53823553f69536b1bd3c9224e8194b2e20766d93e06b0fe2f374722da`.
Each copied artifact was compared with its original using SHA-256. All four screenshots were visually inspected
during this closeout. Their display content is consistent with the assertion groups; screenshot inspection alone
does not establish timing, source retirement or an actual user's reading.

### What actually ran

`apps/desktop/test/c2-presence-native-smoke.mjs` uses a local scripted WebSocket server and built fixture assets.
`apps/desktop/src-tauri/examples/c2-presence-fixture.rs` opens two actual WebView2 windows, Home and Pet, with an
isolated temporary WebView profile. Home contains independent Home and Chat operator clients; Pet supplies a
third client. This tests three independent reporting surfaces, not three separately positioned native windows.

`apps/desktop/test/c2-presence-fixture.tsx` mounts the production `HomeShell`, its real Chat page and production
`ChatBubble` under development `StrictMode`. It uses the production source/exposure hooks and connection owners.
The fixture supplies explicit Pet open/remount buttons, a test-scoped self-window ACL, redirected loopback WebSockets
and a fixture CSP. It does not load a Live2D model or start the production Core/Node, keyring, database or provider.
This is actual native-window/UI evidence with scripted transport, not packaged-production integration acceptance.

| Completed assertion group | Observed boundary |
| --- | --- |
| Independent initial sources | Home/Chat/Pet report separately; initial opening and focus carry null input. |
| Lazy text and closed Pet | Held Markdown leaves the Chat Skeleton ineligible; a committed append does not open Pet or produce Pet exposure. |
| Actual rendered text | Chat and explicitly opened Pet qualify committed text after the two-second dwell; programmatic opening remains input-free. |
| StrictMode and remount | The same physical Pet client retains one source identity through detach/remount and sends no terminal retirement for the render replay. |
| Visible without focus | Unfocused visible Chat text remains eligible. |
| Native minimize and restore | Minimizing Home ends both Home/Chat visibility; a hidden append has no Chat exposure until actual rendering requalifies after restore. |
| Retained route and timezone | Inactive retained Chat is ineligible; Home's explicit follow-device action uses its designated source and reports the actual local timezone. |
| Input trust and aging | Synthetic DOM key input is rejected; browser CDP input is trusted; a later renewal retains the original input sequence and an age over ten seconds. |
| Home-only reconnect | Home gets a replacement source with null old input while the Chat connection remains unchanged. |
| Pet close and native hide | Closing the bubble withdraws its exposure; hiding the native Pet window ends visibility. |
| Offscreen append and reader anchor | A new below-fold message has no exposure; scrollTop stays zero and the original selected text node remains connected with the same selection. |

The timezone screenshot intentionally shows unsupported permission/approval fixture-method errors below the
successfully confirmed timezone section. The scripted server implements the C2 protocol needed by this scenario;
it does not implement the full settings backend. Those red cards do not establish a production permission failure,
and this screenshot is not recorded as a fully successful settings-page acceptance.

### Limits that remain explicit

- CDP-generated trusted browser input demonstrates the producer's `isTrusted` path, not physical-HID input or a human
  reading a message. There is no synthetic human-reading ACK.
- Arbitrary overlapping-window occlusion is not detected. Qualified visible text is bounded presentation opportunity,
  not proof of attention, a same-device Host/operator association or negative feedback by itself.
- The fixture Pet opener, opaque background and absent model do not validate production avatar interaction,
  transparent click-through, costume switching or complete Pet rendering.
- Core authentication, source rejection, durable interval unions, deadline settlement and Monitor producers are
  established by the separate Core/process evidence. This scripted server does not substitute for those checks.
- Fixed/follow timezone revision conflicts and schedule recomputation are covered by owning Core/Desktop tests;
  the native scenario specifically exercises Home follow-device reporting, not every settings transition.
- Subjective owner acceptance, real-provider trials and packaged production acceptance remain unperformed here.

The native fixture was not rerun during closeout. Its covered runtime paths have no semantic source drift: the only
later Desktop changes in the delegated session exported three existing owner classes and annotated factory return
types at `02:39:37Z`. Those changes explain why the final typecheck is later than the original tests/native run.

## Desktop verification

| Command | Actual result and timing |
| --- | --- |
| `pnpm --filter @taki/desktop test` | Original run: 1104 tests in 186 files passed, 24.64 seconds, completed `02:38:17.507Z`. |
| `pnpm exec eslint apps/desktop/src apps/desktop/test/c2-*` | Passed, completed `02:38:04.333Z`. Root's final workspace lint is recorded separately. |
| `pnpm --filter @taki/desktop typecheck` | Passed after the final explicit class exports/return annotations, completed `02:39:57.846Z`. Root owns the current combined typecheck. |
| `pnpm --filter @taki/desktop build` | Earlier success at `02:25:05.643Z` predates constructor/SSR-source corrections. The current successful build below supersedes it. |

The test output, typecheck and scoped lint records are retained in `desktop-prior-gates-2026-09-28.json` rather than
reported only from recollection. A build warning about chunks over 500 kB is retained; it is not a failing exit status.

## Current closeout gates

Heavy checks ran sequentially after the root's serial Core suite completed. The final Desktop suite was not rerun:
the current closeout changed only a Rust test assertion, and the earlier three Desktop class exports/return
annotations do not change the tested behavior. Root also reran all five TypeScript projects successfully; see
[the combined typecheck log](typecheck-resumed-final-2026-09-28.log).

| Command | Completed result |
| --- | --- |
| `pnpm --filter @taki/desktop build` | Exit 0; Vite built in 1.69 seconds. [Final build log](desktop-build-final-2026-09-28.log). The existing chunk-size advisory remains. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked` | Exit 0 after the test correction: 198 library tests plus 7 helper tests passed, no skips. Main/Node/doc targets contain zero tests. Compilation took 26.53 seconds, library tests 1.29 seconds. [Final Rust test log](desktop-cargo-test-final-2026-09-28.log). |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --locked -- -D warnings` | Exit 0 after the correction, 6.16 seconds. [Final Clippy log](desktop-cargo-clippy-final-2026-09-28.log). |

Rust test compilation retains the existing informational MSVC linker-output warning. The required strict Clippy
command passes without a warning suppression. The root's current whole-workspace lint still fails only the
independent QQMM smoke-script line-count guard below; it is not reported as green.

### Fixed integration finding: stale Home ACL expectation

- File: `apps/desktop/src-tauri/src/qqmm.rs`, test
  `management_acl_is_home_only_and_keeps_existing_event_permissions`.
- Before: the exact expected Home permission array omitted C2's authorized `core:window:allow-is-visible`,
  `core:window:allow-is-minimized` and `core:window:allow-is-focused`. The first required Rust run failed with
  197 library tests passed and that one assertion failed; [the failing log](desktop-cargo-test-2026-09-28.log)
  preserves the complete actual/expected arrays. This is an integration omission caused by C2's ACL additions,
  not an independent QQMM production failure.
- Fix: add exactly those three strings to the existing expected array. The exact allowlist, Home-only window
  binding, absence of QQMM permissions in other windows and compiled-authority local/remote denial tests remain
  unchanged. Root explicitly assigned this bounded test correction after the failing gate.
- Verification: full Rust tests now pass, including all three QQMM permission tests, and strict Clippy was rerun
  successfully. No native rerun is needed for a test-only expected-value change.
- Before SHA-256: `c74835a2e43bb6c192d06e2ea2dfaa3bf1f375324824127166b7d083aaa77db4`.
- After SHA-256: `400ad73f81946c7cb87963bfd4f0f830517ff718e9221f9055d550aaa730a9df`.
  Removing only the three added test strings reconstructs the checkpoint hash exactly; every other Desktop/Shared
  checkpoint entry remains unchanged. Existing frontend presence specs already require these self-window reads,
  so no new production contract or specification change is introduced.

## Independent workspace constraints

The [current root lint record](lint-resumed-final-2026-09-28.log) fails on the unrelated
`apps/desktop/test/qqmm-home-native-smoke.mjs` size guard (361 nonblank lines against 360). Root owns the aggregate
report. This Desktop C2 closeout leaves the independent QQMM feature, smoke script and dependencies untouched;
the sole QQMM-named edit is the C2-caused Rust ACL test expectation above. No guard is weakened.

The checkpoint records differing repository/installed pnpm lock integrity for the concurrently developed QQMM
artifact. Desktop checks apply to the currently installed environment; they do not establish a frozen-lock rebuild
of that mutable external artifact. The existing Rust `qqmm-management-native` dependency is also a local path outside
T4; Cargo may compile it as configured, but this closeout neither changes that source nor claims to freeze it.
No dependency lock or external worktree is modified.

The aggregate C2 gate, acceptance status and next-child decision remain in
[the root implementation evidence](implementation-evidence-2026-09-28.md).
