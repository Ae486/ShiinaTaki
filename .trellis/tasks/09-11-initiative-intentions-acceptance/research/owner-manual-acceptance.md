# C4 Owner Manual Acceptance

Status: **pending owner execution and explicit confirmation**. Automated fixtures are engineering evidence only.

## Prerequisites for this T4 build

- Use the current `H:/TakiAgent-worktrees/t4` build on `task/t4-skills-mcp-productization`, with the C4 source
  manifest and engineering evidence alongside this file. Do not substitute Main or an older installed binary.
- A production Shell staging deployment was **not prepared in this round**. The current Shell has no verified
  environment-only profile/endpoint override; see the concrete launch boundary below. The real-Character and
  real-conversation flows remain pending until an isolated deployment is separately prepared. Confirm that its
  intended `taki` Character, permitted model/costume and User Timezone are correct before those flows.
- Real conversation requires an authorized Main Model and working provider credentials. Sampling-dependent
  behaviors require their existing consent/source settings; do not enable a new sensor merely for acceptance.
- Confirm the actual master/periodic/event settings, quiet hours and global limits in **主动互动**. For the
  diagnostic flow, Monitor mode must already be enabled by the delivery owner so **运行监视** is available.
- The isolated `c4-backoff-native-smoke.mjs` fixture has scripted data and no real Core/model/Live2D character.
  Use its screenshots to understand the controls, not to accept real speech, C2 attention evidence or Persona quality.

## Verified launch boundary

This investigation was read-only; no production Shell, ordinary profile or staging deployment was launched.

| Existing source | Effective behavior and limit |
| --- | --- |
| `packages/core/src/config/server-config.ts:42-50` | Core accepts `TAKI_DATA_DIR`, `TAKI_WS_HOST` and `TAKI_WS_PORT`. These isolate a Core process, not the production Desktop Shell. |
| `apps/desktop/src-tauri/src/lib.rs:146-159` | Production Shell uses Tauri `app_data_dir()`, hard-coded `node::DEFAULT_WS_URL`, and `KeyringStore::new()`. It does not read the Core data-root/port variables. |
| `apps/desktop/src-tauri/src/secrets.rs:24,42`; `node.rs:29`; `ws_client.rs:34,134` | The Shell uses the fixed Credential Manager service `TakiAgent`, including `device-id` and `node-token`; rejected authentication can delete that stored token. Redirecting only the browser profile is therefore not Shell isolation. |
| `apps/desktop/src/hooks/use-operator-connection.ts:20,49`; `src-tauri/tauri.conf.json:40,44` | Production operator connections use the fixed default endpoint. Asset scope uses `$HOME/.takiagent/workspace/characters`; CSP permits the default loopback port. An arbitrary Core port does not automatically reconfigure these clients. |
| `apps/desktop/src-tauri/src/bin/taki-node.rs:52-78` | `TAKI_DATA_DIR` and `TAKI_WS_URL` exist for the debug-only **headless test Node**, with a file-backed secret store. They are not production Desktop flags and do not provide its UI or native-dialog acceptance. |
| `apps/desktop/src-tauri/examples/c2-presence-fixture.rs` | The already-built test shell accepts explicit temporary root and asset/WS ports and never boots production Node/keyring. This safely covers production React components, but not the full production Shell or real Character renderer. |

The concrete safe command executed here is `node apps/desktop/test/c4-backoff-native-smoke.mjs`; its evidence is
in `validation/backoff-native-2026-09-28T14-37-32-684Z/`. It must not be advertised as a production deployment.
Setting only `TAKI_DATA_DIR`, `TAKI_WS_PORT` or `WEBVIEW2_USER_DATA_FOLDER` before launching `taki-desktop.exe`
would leave normal Shell state/credentials exposed, so no such ineffective staging command is supplied.

Full production acceptance needs a separately authorized isolated Windows account/VM or a reviewed Shell
profile/endpoint/credential isolation path. Neither was prepared or verified in this round; these are follow-up
choices, not new flags or completed work. Keep the real Character/IME/quality outcomes pending until then.

## Four short owner flows

| Flow | What to do | What the owner should judge |
| --- | --- | --- |
| Chinese input, focus and reading | In **聊天**, compose Chinese with the actual Windows IME, move the caret and keep an unsubmitted draft. Read an older message while a new reply arrives; then switch to **主动互动**, edit a purpose and return. | Composition is not sent early, focus/caret/draft stay usable, new content does not steal the reading position, and ordinary typing/selection feels natural. Record the IME, scaling and any unexpected jump. |
| Real follow-up in Character voice | Describe one genuine bounded upcoming matter through the real model. If a plan is created, expand the original **安排后续跟进** tool result and read/select its recorded outcome and time window. Later observe a fresh eligible follow-up without expecting an expired-thought inbox or a live status update to the original result. | The wording and visible Character/appearance fit the intended Companion; time bounds are understandable; a plan does not promise a message or pretend that the real event was completed. Do not force an unsuitable conversation to create a plan. |
| Interruption and noise quality | During ordinary work and a real primary conversation, leave one explicitly enabled, supported initiative behavior active. Observe a naturally eligible opportunity, then continue speaking or use the existing privacy/quiet controls where applicable. | Initiative feels timely and restrained, yields to the foreground conversation, does not seize window focus or produce duplicates, and the silence/speech/appearance choices are acceptable. This subjective judgment is separate from code-level quota checks. |
| Readable backoff and deliberate reset | Open **运行监视 → 主动互动判断 → 互动频率调整**. Read the real available stage/count/wait information; use **重置互动退避** once if appropriate. If the prepared staging connection is interrupted, read its retained explanation after reconnect before deciding on any further action. | Unknown data is understandable, the reset is clearly deliberate, success and failed refresh are distinguishable, and the text makes clear that global limits and the underlying matter remain unchanged. Do not interpret scripted stages or simply ignoring a message as proof of qualified human response opportunity. |

For each flow record `pass / fail / not run`, one concrete observation, the staging build/profile identifier and
the owner's confirmation. Screenshots may support a finding but cannot replace the owner judgment. Failures return
to the delivery owner with the visible behavior and reproduction steps; do not silently mark the whole C4 accepted.
