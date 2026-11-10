# Local flow simplification without an installer

Date: 2026-11-09. Planning research only; no production implementation or live
profile was started. Source baseline: the current working tree in
`H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

## Owner direction and scope

The owner's latest correction takes precedence over the original installation-led
PRD: first simplify unnecessary steps and checks, permit empty-configuration
startup, and apply configuration changes while the application is running.
An installer, a bundled runtime, a unified launcher, and Shell ownership of the
Core process are not prerequisites for this delivery.

This note owns local connection simplification and the Shell recovery boundary.
Model configuration and runtime replacement have separate planning owners. The
normal Windows development flow remains two independently started components:
`pnpm core:dev` and `pnpm desktop:dev`. Starting either component first must work.
Remote or different-user devices retain their existing explicit pairing path;
this work does not design a new remote connection product.

## Verified current behavior

| Source | Current behavior and implication |
| --- | --- |
| `package.json`; `packages/core/package.json`; `apps/desktop/src-tauri/tauri.conf.json:6` | Core and Desktop have separate development commands. Core starts TypeScript through Node; Tauri starts Vite and the native application. Neither starts the other. |
| `apps/desktop/src/app.tsx:6`; `apps/desktop/src-tauri/src/ws_client.rs:134` | The standalone page relays a human-entered code from the Core console to the Rust execution Node. The native handshake waits on `pairing_rx` after `PAIRING_REQUIRED`. |
| `packages/core/src/server/methods/connect.ts:87`; `packages/core/src/config/server-config.ts:15` | Default loopback auto-trust covers operators only. It does not automatically enroll the execution Node. A wrong existing token fails before auto-trust is considered. |
| `packages/shared/src/connect-schema.ts:29` | Operators cannot advertise capabilities or a Host declaration. Nodes must negotiate Host protocol support. These checks protect distinct roles rather than add a user-facing ceremony. |
| `packages/core/src/devices/device-registry.ts:60`; `packages/core/src/devices/paired-device-store.ts:44` | Pairing and auto-trust use the same durable token issuer. Tokens are role-bound and stored as hashes; corrupt existing device storage is an error, not an empty first-run store. |
| `apps/desktop/src/lib/operator-auth.ts:24`; `apps/desktop/src/lib/device-identity.ts:8` | Home, Pet, and Chat share a same-origin operator identity in localStorage while retaining independent physical WS connections. |
| `apps/desktop/src/hooks/use-operator-connection.ts:20` | All three browser connection owners currently use the fixed default WS endpoint. The Rust Node separately reads `TAKI_WS_URL` in `lib.rs:169`; changing only that variable does not redirect the browser clients. |
| `apps/desktop/src-tauri/src/lib.rs:152`; `apps/desktop/src-tauri/src/secrets.rs:20` | The daily Shell uses the `TakiAgent` keyring namespace. An explicit Shell profile hashes the literal path into another namespace. Do not normalize or relocate those existing identities accidentally; see T4-D83. |
| `packages/core/src/secrets/master-key.ts:29`; `apps/desktop/src-tauri/src/bin/taki-secret-key.rs:36` | Core already has a framed helper seam into the same interactive user's credential store. Helper get/create is reusable at the primitive level. The catalog master key must not be reused as a connection secret. |
| `apps/desktop/src-tauri/Cargo.toml:23`; normal development scripts | `taki-secret-key` is a separate binary, but normal development commands do not explicitly build or locate it for Core. Its mere presence in Cargo is not a ready local-bootstrap path. |
| `packages/core/src/server/ws-server.ts:39` | The current WS listener does not inspect Origin. A label, Origin, loopback IP, or absence of Origin alone cannot establish native application identity. |
| `apps/desktop/src-tauri/build.rs:9`; `capabilities/home.json`; `capabilities/legacy-app-commands.json` | Native commands have a finite generated command inventory and window capability declarations. The existing QQ adapter additionally checks the actual invoking native window. This is an established pattern for a narrowly scoped native bootstrap command. |
| `apps/desktop/src-tauri/tauri.conf.json:44` | Asset access is restricted to the Character tree; there is no browser file-read permission for Core security state. Production CSP currently permits only the fixed local WS endpoints. Preserve that boundary rather than exposing bootstrap files through the asset protocol. |

The current auth spec explicitly separates connection admission, Core governance,
and Host final enforcement. Removing the local code entry does not remove the
latter two layers (`.trellis/spec/backend/server-push-and-connection-auth.md`).

## Routes compared

### Existing broad loopback trust

Keeping existing operator auto-trust removes no remaining Node code entry.
Extending it to `role=node`, allowing a client-supplied "native" flag, or treating
an absent Origin as native would admit unrelated local processes as execution
Hosts. That conflicts with the existing role/catalog contract. This shortcut is
not a viable route under the retained permissions requirement.

An Origin check remains useful for rejecting unrelated browser pages, but is not
an alternative to authenticating native clients: non-browser clients can choose
their headers. Exact allowed development/app origins need a real Tauri check;
wildcards and `null` must not silently become new trusted origins.

### A. Private local rendezvous plus native bootstrap

Core and Shell rendezvous through a narrowly scoped, per-user/profile local
bootstrap record. The record provides running-Core identity and the material
needed for a native-only admission exchange. Renderers receive only short-lived,
single-use connection tickets, never the reusable bootstrap secret.

This can support separate processes and either startup order. It does not require
an installer. However, it is **not currently an implementation-ready, helper-free
solution on Windows**:

- Core's `fs` writes and `mode: 0o600` do not establish a Windows owner-only DACL.
  The inspected code has no existing create/verify-private-bootstrap-directory
  adapter. The encrypted catalog's staged-file helper is not evidence otherwise.
- A concrete creator and verifier are required before enabling the path: a small
  Windows native adapter/helper must create a new dedicated directory with the
  intended DACL and verify any existing record's security boundary. Merely adding
  an `aclVerified` JSON field is not verification.
- Making Shell the only creator cannot assume that Shell ran first. A Core-first
  launch must keep its basic service available while local admission waits; later
  Shell preparation must be observable without restarting Core. Making Core the
  creator instead requires a callable native primitive before publication.
- Do not change permissions recursively on an existing custom data directory.
  Refuse an unsafe/unverifiable rendezvous location with an actionable state, or
  use a separately secured location. Preserve the existing profile unchanged.

Benefit: no reusable connection secret in the general catalog and a direct local
rendezvous. Cost: new Windows filesystem-security code, startup-order coordination,
and temporary-file cleanup/verification. This route needs an isolated ACL and
rendezvous spike before it can be selected.

### B. OS credential bootstrap through the existing helper seam

Use a dedicated per-profile connection bootstrap account in Windows Credential
Manager, shared by Core's narrow helper and the Shell's native `KeyringStore`.
Keep it separate from the catalog master key, provider credentials, Node reconnect
token, and browser-attachment credentials. Core owns credential creation through
the helper's existing serialized create-only primitive; Shell reads the winning
value through the native store.

Publish only a non-secret running-Core descriptor from Core after its basic
listener is ready. Native code derives the connection-account name from a bounded
profile identifier; it does not accept an arbitrary credential account or path
from the renderer or descriptor. The descriptor selects an endpoint and instance;
it is not itself trusted proof of the server's identity.

The normal development commands need reproducible helper preparation and absolute
path injection. This is per-component development preparation, not a unified
launcher and not an installer requirement. The current binary links the Desktop
library, so the spike must check its actual frontend/build prerequisites rather
than assuming `cargo build --bin taki-secret-key` is a standalone cheap build.
If that coupling is excessive, isolate the existing narrow helper implementation
as a build responsibility; do not put Windows keyring logic throughout Core.

Startup order:

1. **Core first:** Core's basic service starts without model configuration. It
   prepares/reads the connection account when the configured helper is available,
   and exposes local-bootstrap readiness separately. Missing helper or keyring
   failure does not masquerade as model failure or erase Core state.
2. **Shell first:** Home opens. With no valid current Core descriptor/listener,
   connection status says the local service is unavailable and reconnects within
   the existing bounded lifecycle; it does not display a pairing-code form or
   launch an unrequested Core process.
3. **Second component arrives:** native bootstrap verifies the selected running
   Core and obtains connection tickets. Existing independent connection owners
   then authenticate and restore their own subscriptions. No app restart or
   user-entered code is required.

Benefit: reuses existing OS credential access, create-only race handling, and the
Core/native boundary. Cost: helper build/discovery must become dependable in the
development flow; a small authenticated bootstrap/ticket protocol is still new.
The protocol is not supplied by the current helper automatically.

## Recommendation and bounded feasibility gate

**Use route B as the planning baseline.** It has the stronger existing Windows
primitive and avoids pretending Node file modes establish private ACLs. Keep A as
the alternative if a small native ACL/rendezvous spike demonstrates lower total
coupling. Neither route is considered live-verified by this research.

Before locking the wire format, run one isolated, no-model spike with temporary
profile identities: helper build/discovery, create-only concurrent account access,
Core-first/Shell-first readiness, native server authentication, short-lived tickets,
and wrong-endpoint rejection. Use dedicated test credential accounts with explicit
ownership/cleanup; never exercise the daily profile. Record any new narrow crypto
dependency rather than implementing an ad-hoc MAC from raw SHA-256.

Do not turn this gate into an installer project. The deliverable remains a working
local flow through the ordinary separate development commands.

## Admission and recovery contract

- The native bootstrap exchange authenticates the selected server before sending
  any long-lived reconnect credential. A non-secret descriptor, listening port,
  process ID, successful TCP open, or matching instance string is not sufficient
  proof. Bind the authenticated exchange to the server instance and endpoint.
- Renderer admission uses bounded, short-lived, single-use tickets tied to the
  verified instance, endpoint, device identity, and role. A wrong-port service or
  stale descriptor must not receive long-lived credentials. Reconnect obtains a
  fresh ticket when the instance changes; no reusable bootstrap key enters JS,
  localStorage, a URL, an event broadcast, logs, or a provider request.
- Finalize the same-socket proof/ticket binding in the spike, including the interval
  between native verification and the renderer's physical socket open. A check on
  one socket followed by sending a durable token on an unverified new socket does
  not close the wrong-endpoint gap.
- Reuse `DeviceRegistry` as the durable device/role/token authority. Do not mint a
  new persistent token on every Home/Pet/Chat connection or overwrite another role's
  existing device record. Serialize same-identity enrollment so concurrent windows
  cannot invalidate each other's accepted credentials.
- Native commands derive allowed role and profile internally and check the actual
  invoking WebView. Home/Chat/Pet may obtain operator admission only. The execution
  Node's admission remains native-only. No generic secret-read or arbitrary-file
  API is added.
- Native window identity and supported app/dev origins both matter. Keep Home's
  `home` label, its QQ/browser command permissions, and independent operator
  connections. Do not rename the page to `main` without migrating those contracts.
- Replace broad implicit loopback admission in the ordinary native Desktop path
  with authenticated local bootstrap. Preserve existing valid device credentials,
  explicit remote pairing, and the role checks. Document the exact compatibility
  meaning of the old `TAKI_TRUST_LOOPBACK_OPERATOR` option; do not silently treat an
  explicit trust-disabled deployment as permission for a new unauthenticated path.
- Credential lookup failures, corrupt device storage, stale authentication, absent
  Core, and a disabled optional integration are distinct states. Bounded recovery
  must not erase identities, re-create an empty profile, or endlessly rotate keys.
- The shared-credential boundary is the same logged-in Windows user and selected
  profile, plus the native-to-renderer command boundary. It does not claim isolation
  against malicious native code already running with that user's credential-store
  access, nor against an administrator. Loopback browser reachability alone grants
  no identity.

## Home and Shell recovery belong in the same delivery

Open Home as the primary native window before attempting the fallible Node/Core
connection work. Source evidence for the current failure coupling is
`lib.rs:104` -> `node.rs:79-82` -> `browser_attachment.rs:66-83`.

The existing browser adapter correctly treats a missing configuration as disabled,
but unreadable/bad JSON, an invalid port, or a bad credential fails Node assembly
and propagates out of Tauri setup. Represent those failures as local capability
readiness and preserve a usable Home. Identity failure must disable the affected
execution connection safely, not cause a fresh identity to hide the error.

Home must work in three different situations: Core absent, Core basic service
ready with no model, and Core/model ready with no Pet resources. Setup requiring
Core reports that prerequisite accurately; local Shell diagnostics and retry stay
available without Core. Core process launch/restart ownership is not added here.

## Remove ceremonies; retain correctness checks

Remove the standalone local code-entry page, console-to-UI copying, duplicate
connection confirmations for each window, and model/renderer readiness as a gate
on opening Home. A user configuring an ordinary local profile should not need to
understand the native bootstrap exchange.

Retain role/schema validation, authenticated profile selection, native command ACLs,
Core governance and Host enforcement, corrupt-storage refusal, operation-generation
checks, and unknown-outcome handling. These checks protect identity, stored data,
and effects; they are not additional onboarding steps. Keep explicit pairing only
where the device is outside the supported same-user local relationship.

## Acceptance and evidence boundaries

1. Start Core and Desktop separately in both orders with no model, no Character,
   and no prior local device tokens. Home opens and the local Node/Home/Pet/Chat
   relationship needs no manually entered code. No installer or unified launcher
   participates in the test.
2. Restart either component, open/reopen Home, and create concurrent Home/Chat/Pet
   sockets. Stable identities and independent subscription owners remain intact;
   no repeated enrollment rotates another window's credential.
3. Missing Core, missing/unlaunchable helper, inaccessible keyring, bad optional
   browser configuration, and unreadable device storage each produce the correct
   reachable recovery state without overwriting existing state.
4. An unrelated web Origin, unauthenticated native socket, wrong role, wrong
   profile, expired/reused ticket, stale descriptor, and service occupying the
   expected port cannot obtain trusted operator/Host admission or long-lived
   credentials. Exercise the actual WebView/native command boundary as well as
   protocol tests; a raw socket test alone is not a browser reachability test.
5. Existing explicit remote pairing and valid role-bound tokens retain their
   supported behavior. Explain any intentional configuration-semantics change.
6. Disconnect during a mutation or reply. Existing outcome reconciliation and
   draft/stale-state behavior remain; bootstrap retries never replay user effects.
7. After local admission, the separate empty-config/model-activation slice can
   complete configuration and obtain a first reply without restarting the app.

Static source review is complete for this note. No selected bootstrap protocol,
Windows credential-account spike, private-directory ACL, actual Origin mapping,
native fault-isolation UI, or end-to-end first-use flow was implemented or run.
