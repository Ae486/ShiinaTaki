# Stage 5A Home implementation

Status: Home source released for the consolidated 5A gate and independent review. No Shared/Core/Native source,
task status, original data, deployment, model invocation or Git commit was changed by this Home implementation.

## Delivered behavior

- Added the configuration observation section to the existing Operations page. Global and imported Character
  choices resolve through Core; actual roster failure has an explicit retry. No arbitrary Native target is accepted.
- Added strict Shared-validated `WsClient.hindsightConfigurationStatus/Observe` methods and classified both as
  ordinary interactive reads. The feature does not call health, setup, provision, activation or model methods.
- The framework-free controller rejects obsolete client/scope responses, serializes reads, hides old comparisons
  immediately on refresh and after failure, and sanitizes transport errors to a fixed view state. Mount/reconnect,
  visible-page restoration and focus retrieve Core status. Explicit observation is never automatically replayed.
- Core `validForMs` is reduced by response transit time. Each published observation gets one expiry/status read;
  the same expired observation identity cannot rearm a loop. Hidden-page/client retirement cancels the timer.
  There is no browser persistence, observation polling or invented push producer.
- The table separates desired settings, actual permitted provider/configured-model aliases and Core comparisons.
  Default/retain/reflect/consolidation profiles include supported, disabled and typed unknown states. API replicas,
  Workers, embedding and reranker remain visibly unknown. Unpinned Bank identity and alias limits are explicit.
- Denied, unsupported, unavailable, mismatch, expired and identity-refused states use closed safe wording. Runtime
  session IDs, nonces, build hashes and raw errors are absent from product presentation. Existing Operations cards
  remain independent from this optional capability.

## Source ownership

`apps/desktop/src/lib/`:

- New configuration method module and actual WsClient contract tests.
- Updated public client composition, request method composition, read deadline policy and directory index.

`apps/desktop/src/windows/home/pages/operations/`:

- New configuration card/state/controller, connection and roster hooks, controller/card/browser tests and a test-only
  disposable authenticated Core WS fixture. Existing Operations root and index updated.
- The browser fixture reuses the actual Core configuration service and bounded Native-client fixture supplied by
  the Core implementer. Its only synthetic roster contains `taki`; no installed Native, real credentials or corpus.

`.trellis/spec/frontend/home-window.md` records the optional observation lifecycle and evidence boundaries.
Exact SHA-256 and byte length for all 18 owned source/spec/index files are in `home-source-identities.json`.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Initial focused controller + actual WsClient | 2 files / 13 tests PASS, exit 0 | `home-focused-second.log` |
| Final focused + adjacent Home suite | 6 files / 26 tests PASS, exit 0 | `home-focused-final.log` |
| Actual browser / authenticated Core WS | 1 test PASS, exit 0; no browser page errors | `home-browser-second.log`; `home-browser/91ba0bc1-d95e-4a58-bf49-16265a86a86f/result.txt` |
| Desktop typecheck after compatibility fixes | PASS, exit 0 | `home-typecheck-final.log`; release confirmation in `home-typecheck-release.log` |
| Focused ESLint over all changed Desktop TypeScript files | PASS, exit 0 | `home-lint-second.log` |
| Owned tracked source/spec whitespace check | PASS, exit 0 | `git diff --check -- apps/desktop/src .trellis/spec/frontend/home-window.md` |

The final focused suite covers actual Core comparisons, denial/failure removing prior evidence, two observer
controllers, reconnect/remount, old client/scope responses, wrong-scope refusal, raw-error suppression, expiry,
one-shot behavior, transit-time expiry and disposal. Static card tests supplement actual producer/DOM tests with
all closed states, routed/custom/disabled profiles and unpinned identity. Adjacent checks cover Home readiness,
shell rendering and navigation boundary. The actual browser uses real React hooks/card/WsClient/authenticated Core
dispatch/service/client, exercises selectable scope, two observers, initiating-window closure, reconnect, remount,
expiry, denial and failed refresh, and asserts zero localStorage keys. Its Native transport accepts only version
and configuration-observation routes; an unexpected health/model/write route fails the fixture.

The observed screenshot and failed-remount screenshot were retained. `observed.png` was visually inspected:
labels, long values, partial coverage, desired/actual columns and the mismatch indication were legible.

## Preserved failed attempts

- `home-focused-first.log`: exit 1 before tests because Vitest 4 does not accept `--minWorkers`; rerun used only
  `--maxWorkers=2` and passed.
- `home-browser-first.log`: exit 1 on test fixture import of undeclared Desktop `zod`. Fixed by reusing the existing
  public `CharacterListParamsSchema`; no dependency was installed.
- `home-typecheck.log`: exit 2 for a constructor parameter property disallowed by `erasableSyntaxOnly` and test-only
  `Promise.withResolvers` unavailable in Desktop's library target. Replaced with an explicit field and local test
  deferred helper; no target/lib relaxation.
- `home-lint-final.log`: exit 2 because PowerShell passed an array as one pattern through the pnpm script wrapper.
  Retried with `pnpm.cmd exec eslint @files`; all owned files passed. The earlier failed log remains unchanged.

## Remaining integration and acceptance boundaries

- Shared/Core/Native code and the fixture dependency remain owned by the main implementer. Their final consolidated
  gates and independent 5A check must include this source release. Home does not claim the whole vertical slice passed.
- The browser check passed before the constructor's TypeScript-only syntax adjustment; the final focused suite
  executes the corrected controller and final Desktop typecheck validates it. No behavioral browser change followed.
- Full Desktop build/suite and repository-wide lint/typecheck are delegated to the main implementer's consolidated
  gate rather than run concurrently or duplicated here.
- This is owned headless Chromium evidence, not packaged WebView2/CSP, original-instance grants, installed Native,
  real model execution or owner/manual acceptance. Those boundaries remain unperformed.

No known Home blocking issue remains at source release.
