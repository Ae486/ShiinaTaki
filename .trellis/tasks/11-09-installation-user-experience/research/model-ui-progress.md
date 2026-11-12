# Model configuration UI implementation and evidence

Date: 2026-11-10. Workspace: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`. The explicit installation UX task and current session
binding are authoritative; the legacy global `.current-task` still names an unrelated task.

## Implemented

- Settings begins with grouped Main and Utility profile cards, using the existing Home
  palette, Field/Badge/ActionButton components and layout. The six legacy connection-field
  editors are replaced by these cards; ordinary scalar/context settings remain available.
- One Save action persists incomplete drafts or applies complete profiles. Keyless custom
  model IDs need no catalog lookup or test. Utility explicitly chooses inherited Main,
  an independent profile, or disabled mode. Reset deliberately restores fallback ownership.
- API keys are write-only inputs. Reads contain presence only; matching endpoint presence
  allows retaining a key. Selecting no authentication removes local key input and explicitly
  suppresses environment credential fallback through the Core profile contract.
- Local inputs survive reconnect, late replies and competing changes. Expected revisions
  protect writes. A conflict keeps inputs and offers load-latest or keep-inputs-against-latest.
  Unknown acknowledgements require a fresh read before another explicit action; nothing
  automatically repeats saves or potentially chargeable tests.
- The optional cost-labelled Test sends the current unsaved candidate and does not publish
  it. Saved state, active model/source, application failure and test outcomes remain distinct.
- Chat observes Main on its independent socket. It keeps Timeline/navigation/configuration
  accessible with missing or disabled Main and only gates new sends, with a Settings entry.
- Scalar fields now state application-first precedence, remain editable when supplied by
  environment fallback, and show Core-produced source/application boundary/state. Resets use
  the returned effective fallback or an explicit older-Core read; they never assume default.
  Application-change pushes trigger bounded covering reads, and old echoes cannot regress
  newer application observations.
- WS additions use Shared schemas, physical-client subscription reuse and route cleanup.
  The profile read model reuses `ReadCoordinator`; no polling or durable browser store was added.

## Owned files

Production additions: `apps/desktop/src/lib/ws-client-model-profiles.ts`, Home
`model-profiles-controller.ts` / `use-model-profiles.ts`, Settings `model-profile-form.ts`,
`model-profile-editor-controller.ts`, `use-model-profile-editor.ts`, `model-profile-fields.tsx`,
`model-profile-card.tsx`, `model-profiles-section.tsx`, `config-application-view.ts`, and Chat
`chat-model-availability.tsx`.

Integration changes: `ws-client.ts`, `ws-client-methods.ts`, `ws-client-routes.ts`,
`rpc-deadline.ts`, Settings composition/scalar observer/save/state/editor and model-capability
guidance, Chat composition, colocated tests and the touched directory indexes. Concurrent
native-auth and pre-existing maintenance edits in shared files were preserved.

Specs: frontend `reactive-read-models.md`, `home-window.md`, and `index.md`.
Native driver: `apps/desktop/test/model-profile-native-smoke.mjs`.

## Verification

- `pnpm --filter @taki/desktop test`: 228 files / 1395 tests passed at 16:20 local time.
  This includes revision conflicts, incomplete drafts, key retention by endpoint,
  old-generation suppression, explicit unsaved tests, unknown-outcome read-first handling,
  scalar environment reset, newer application observation and WS notification lifetime.
- Scoped ESLint passed for all owned production files, tests and native driver.
- Final focused suite: 20 files / 156 tests passed at 16:27 after final feedback and
  scalar acknowledgement assertions.
- Final `pnpm --filter @taki/desktop typecheck` passed after the integration owner added
  the new `index.rebuild` operation label. No outstanding Desktop type errors remain.
- `git diff --check` passed for owned tracked changes.

### Actual native UI with real Core

Reused the native worker's isolated production Core (port 18976, PID 28216) and production
Rust/WebView2 Desktop executable (PID 12036, CDP port 19224), with Vite frontend port 1420.
The Core/Shell/WebView fixture lived under
`G:/taki-native-flow-artifacts-20261110/startup/`; no real user profile was read or mutated.

Command:

```powershell
$env:MODEL_UI_CDP_PORT='19224'
$env:MODEL_UI_ARTIFACTS='G:/taki-native-flow-artifacts-20261110/model-ui-final'
node apps/desktop/test/model-profile-native-smoke.mjs
```

Eight scenario assertions passed:

1. Save incomplete Main draft without any provider call.
2. Reload actual Home and restore that draft without local enrollment/code entry.
3. Complete a custom keyless Main profile using ordinary Save, without a test.
4. Explicitly test an unsaved model exactly once without changing the active profile.
5. Save an invalid URL candidate and retain the prior active model with a useful failure.
6. Independently configure Utility, disable it, then explicitly inherit Main.
7. Receive a first local reply, switch Main, and receive the next reply in the same
   conversation using the new model without restarting either process.
8. Disable Main and keep prior history visible alongside configuration recovery.

The deterministic provider observed exactly three requests in the successful final run:
`unsaved-test-model` (non-stream test), `local-main-a` (stream), and `local-main-b` (stream).
None carried Authorization; paid-provider calls were zero. The fixture provider closed
after verification. Main was intentionally left disabled in the isolated profile.

Evidence:

- `G:/taki-native-flow-artifacts-20261110/model-ui-final/model-ui-native-results.json`
- `.../model-ui-final/02-keyless-model-active.png`
- `.../model-ui-final/03-failed-candidate-retained-active.png`
- `.../model-ui-final/04-chat-live-model-switch.png`
- `.../model-ui-final/05-disabled-model-history.png`
- The truly empty initial Settings screenshot is
  `G:/taki-native-flow-artifacts-20261110/model-ui/01-empty-model-settings.png`.

Screenshots were visually reviewed. The initial failure UI repeated the same outcome
in three warning boxes; it was consolidated into one concise warning and the native
scenario rerun successfully. The retained active identity remains visually separate.

## Remaining evidence boundaries

- These are actual native WebView and real Core observations, with a local deterministic
  provider. They are not real paid-provider acceptance or owner/manual acceptance.
- Frontend assets were Vite-served. Packaged CSP/build verification remains an integration
  check; this UI adds no dependency, external origin or CSP exception.
- Unknown acknowledgements and competing editors are covered deterministically, not by
  native transport fault injection in this smoke.
- Startup/performance distributions, optional integration recovery and the complete
  scalar consumer matrix belong to the overall task and are not closed by this UI proof.
- No Hindsight-specific implementation, commit, push, archive or finish action was performed.
