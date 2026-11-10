# Design: simpler local use and live configuration

Status: owner-authorized development under the PRD, beginning with startup tracing and S0 proof. Proposed technical details below remain subject to that evidence; they are not implementation claims.
On 2026-11-10 the owner reserved Hindsight key logic for its concurrent dedicated
task. The Hindsight internal application proposals below are coordination contracts,
not authorization to change those internals in this task. Necessary shared adapters
are itemized in `research/hindsight-change-inventory-20261110.md`.
The configuration-source decision is confirmed. Remaining proof gates below are technical
implementation checks, not a request to reopen that decision.

## 1. Selected direction and alternatives

Keep the existing Core, Shell, independent operator clients, configuration store, Secret
Catalog, RunService, Utility queue, and Memory authority. Separate their initialization
and application boundaries instead of restarting or rebuilding the entire runtime.

| Route | Benefit | Cost / decision |
| --- | --- | --- |
| Rebuild the whole runtime whenever configuration changes | Small initial wiring change | Disrupts active work, authority fences, timers and queues; rejected. |
| Read every dependency dynamically on every SDK step | Fast apparent updates | Mixes model/prompt/policy inside one Run; rejected. |
| Read scalars at use, capture operation policy, replace only the affected component | Fits existing ownership and preserves active work | Requires explicit consumer boundaries; selected. |

The [consumer matrix](research/config-runtime-application.md) owns the exact 84-setting
inventory and backend applicability. This design owns cross-cutting behavior, without
duplicating every key. The [local-flow research](research/local-flow-simplification.md)
owns authentication alternatives and their evidence.

Optimization is an explicit owner requirement: choose the simplest complete user flow
and reduce unnecessary work on startup and ordinary request paths. State/revision
machinery must not become extra user procedures or duplicate runtime infrastructure.
Avoid adding per-request full-config reads, keyring/helper process launches, whole-runtime
reconstruction, or background polling without evidence that the path requires them.

Frameworks and libraries are allowed; preserving ownership does not require handwritten
infrastructure. When a maintained library can replace meaningful custom lifecycle,
state-transition or protocol logic, compare it with existing capabilities and a focused
implementation. Check applicable versions, integration/disposal behavior, startup and
memory/request costs, and maintenance burden. Select it when total benefit is better;
dependency minimization and adopting a framework are not goals by themselves. Record
the concrete decision and measured costs without turning routine choices into a new
approval workflow. Revisit a selected route if it worsens usability or performance.

## 2. Startup and availability

Split the current bootstrap/composition into a basic service plane and feature activation.
These are responsibilities within the existing Core, not separate services or databases.

| Owner / availability | What remains usable | Dependent work |
| --- | --- | --- |
| Native Home shell | Navigation, local connection state and recovery, deferred avatar entry | Exists before fallible Node/optional-adapter initialization. |
| Core basic plane | Config/profile read-write, secret health, device connection, history, Character resources, status/subscriptions | Requires the selected data store to open correctly, not a model. |
| Main model binding | Text/image chat, primary/delegated/initiative work | Requires a locally applicable Main profile; network success is an observed outcome. |
| Utility binding | Eligible maintenance through the existing queue | Inherit Main or use a complete independent Utility profile. |
| Perception / avatar / optional integrations | Their existing non-model capabilities and management | Each retains its own prerequisite/privacy/permission state. |
| Selected Memory authority | Existing history/management and supported reads | An unavailable external authority never becomes a fresh empty Local authority. |

Initial empty model fields are expected states, not exceptions. Isolate malformed
feature configuration and optional-adapter failures where their actual owner permits;
do not catch every exception and report successful startup. Fatal data-store or invalid
bootstrap-address failures remain distinguishable. A disconnected Home reports only
known facts, not an invented database/credential diagnosis.

Register stable APIs before model activation. Model-dependent entry points return a
typed feature-unavailable result with the corrective target, rather than disappearing
from the method registry. Guard admission before accepting work that cannot run.
Schedulers keep persisted definitions and existing missed-work/retry semantics; activation
must not replay all historical triggers or create a second queue. Model tests are never
startup probes. No dummy model or empty-result adapter substitutes for an unavailable one.

Core-first and Desktop-first remain supported through separate existing commands.
Home must open before Node identity/browser initialization; failures affect that connection
or capability. Preserve the actual home window label, its permissions, independent
Home/Chat/Pet socket owners, and external QQ Host ownership.

## 3. Local connection without a code

Use the existing OS-credential helper/native keyring route as the planning baseline.
A dedicated per-Core-profile bootstrap account is separate from catalog master keys,
model secrets and existing reconnect credentials. Core creates/reads it through the
narrow helper; native Shell verifies Core and obtains bounded admission tickets.
DeviceRegistry remains the only durable device/role authority.

Normal component commands prepare/locate the existing helper automatically. This is
development/runtime preparation, not an installer or a combined process launcher.
Core and Desktop remain independently startable. Missing helper/credential access is a
repairable local readiness state, not a reason to request a manual code.

Native commands derive the permitted profile, role and actual invoking window.
Renderer admission cannot request Node authority or read arbitrary credentials/files.
Preserve independent operator restoration and existing operation approvals.
Replace broad loopback trust in the ordinary native path; origin checks alone do not
prove native identity. Keep explicit remote/headless compatibility separate.

Before fixing the final wire format, prove helper build/discovery, concurrent create,
both startup orders, server authentication, ticket instance/endpoint/device/role binding,
expiry/replay refusal and the native-verification-to-renderer-socket interval. Existing
credential revocation must not be bypassed by automatic re-enrollment. Reuse native
credential/standard cryptographic primitives, not a custom cryptographic algorithm.
If helper coupling proves unsuitable, the private-rendezvous alternative requires an
actual Windows ACL creation/verification primitive; Node mode 0600 is not proof.

This trust boundary is the selected profile and logged-in OS user. It does not claim
isolation from malicious native code that already has the same user's keyring access.
Keep T4-D83 identity compatibility: no new namespace solely from path normalization.

## 4. Configuration ownership and persistence

Confirmed precedence for editable values: application-saved > environment > default.
Change ConfigSource, config.set validation, model/profile resolution, CLI projections,
and UI labels together. Remove ordinary env-locked refusals; keep the data-root
bootstrap exception. Presence is explicit: false, zero, and intentional no-auth/disable
must not accidentally fall through to environment values. Invalid saved values are
diagnosable, never laundered through a silent fallback.

Keep the sparse config table for scalar values. Related model fields form a Core-owned
profile revision, backed by the same SQLite connection and Secret Catalog. A profile
contains endpoint, model ID, auth choice/reference, and mode. Do not build a second
JSON settings store. Utility supports inherit, explicit profile, and disabled modes.

Model source selection is group-coherent: an application-owned profile does not borrow
a missing credential or model ID from an unrelated legacy environment profile.
A saved incomplete draft is not an active profile and does not take over the currently
active binding. The UI identifies draft source and active source separately.

On adoption, existing stored values win as the owner selected, including legacy model
fields. Preserve old environment/config files and first resolve an application-first
candidate. A complete locally applicable candidate is adopted without making the user
save it again. Environment credentials may fill an absent authentication choice only
when their source belongs to the candidate's effective endpoint; never copy an old
endpoint's key to a newly selected endpoint. Explicit no-auth remains valid. If a
candidate is incomplete/inconsistent or needs credential selection, preserve a known
previous active binding only with an explicit desired-versus-active correction state;
do not silently keep environment precedence. Record per-field source and the reason
for any retained old binding. Add old stored/env conflict fixtures; do not destructively
migrate files or populate every default row.

| Action | Meaning |
| --- | --- |
| Save draft | Persist incomplete input safely; no provider request and no active replacement. |
| Save and apply | Save a complete candidate, perform necessary local preparation, publish the new active revision. |
| Test connection | Optional explicit bounded request for the current draft/revision; disclose cost and retain its actual result. |
| Reset to environment/default | Deliberately remove the application override and show the selected fallback. |
| Disable Main / Utility | Block new dependent work; retain history and existing admitted captures. |
| Remove API key / use no authentication | Persist the explicit auth choice; do not resurrect an environment key. |
| Revoke/cancel existing work | Separate existing control, not a hidden side effect of an ordinary edit. |

Core never returns model secrets to clients. Reopen shows presence and accepts a replacement.
Keyless compatible endpoints are allowed by the installed adapter; no fake key, catalog
match, model-list query, or paid test is required for activation.

Secret publication spans encrypted catalog and SQLite and cannot be one filesystem
transaction. Stage a revision-specific secret, commit the candidate's reference and
non-secret fields, prepare the consumer, then publish its active revision. Preserve
the previous reference until no admitted work uses it. A failed stage/commit leaves
a diagnosable pending/orphan candidate without changing the active connection; reconcile
on reopen. Never clear unrelated catalog entries or overwrite an unreadable catalog.

Keep desired revision, last successfully applied revision and observed apply outcome
distinct. Reopen re-prepares committed state locally and reports its actual status;
a prior successful test is not a permanent provider-health certificate. Competing
edits use an expected revision. A lost acknowledgement is resolved by reading the
revision/result, not blindly repeating the command or test.

## 5. Runtime application

Use a narrow configuration application coordinator for serialized revision publication
and status fan-out; actual preparation/disposal belongs to existing feature owners.
A suitable library may support this coordinator without adding another runtime authority
or permanent task queue; use the dependency-selection criteria above.

- Immediate scalar readers: logging and existing live timing/policy consumers.
- Captured values: model/credential/prompt/context/limits at Run or maintenance admission.
- Owned component replacement: persona producer, prepared search query, sampler/GC,
  listener and active integration connection, with one owner and disposal path.
- Managed maintenance: tokenizer/index changes under existing Memory operation ownership.
- Bootstrap exception: data-root change remains an explicit migration/reopen operation.

Capture the selected model handle, private credentials, policy, prompt revision and
non-secret identity together at the existing admission seam. Extend Run snapshot
capture and persisted model attribution consistently. A queued Run is already admitted;
retry/continuation and prepared publication retain its binding. A newly admitted child
uses the model policy required by its existing lineage contract, not an accidental
global read. Release old handles through existing terminal/disposal ownership.

Main changes must update new-Run attribution and calibration together. Late measurements
from old model generations cannot train the new model's effective context limit.
Utility retains one serial queue and independent operation captures. Do not replace
the Memory authority or re-ingest stored history to switch models.

For privacy, stop scheduling and retire the evidence epoch immediately; old captures
cannot authorize later evidence use. Preserve explicit stored expiries and protected
media leases during retention changes. For stoplist updates, rebuild applicable
derived indexes and change writer/query tokenizer generation coherently; report
maintenance/failure instead of an empty corpus. Already captured Memory tools must
also call a matching tokenizer/index generation after the switch: borrow the current
same-authority projection atomically per Memory call, or coordinate a quiescent switch
that redirects retained tools safely. This does not change the Run's model/prompt or
Memory authority and does not require keeping an entire old runtime alive. Legacy-only
BM25 weights remain honestly inapplicable to other backends.

Already-live Hindsight settings also need coverage: local timeout/policy updates,
validated reconnection to the same authority/Bank, and deployment-template fields
have different boundaries. A model/config edit cannot silently change authority,
replace a Bank, or imply server-side configuration took effect. Preserve supported
reads and report the specific blocked operation when the selected authority is absent.

Listener host/port changes prepare a replacement, publish authenticated endpoint
discovery, and reconnect clients using existing generation recovery. Failed preparation
keeps the old listener. Authentication/endpoint failure never repeats effectful RPCs.
Existing chat-on-disconnect cancellation semantics must remain explicit in the UI;
a listener change does not promise uninterrupted streaming or full-restart continuation.

## 6. UI and protocol

Home uses the existing page registry, read models and operator recovery lifecycle.
Show an actionable model setup entry in Chat/Settings without a mandatory wizard.
Settings exposes coherent Main/Utility profiles and readable application boundaries.
Avatar preparation is optional; repair uses existing import/resource entry points.
No global UI redesign or new asset marketplace is required.

Shared owns additions for feature readiness, profile revisions and application results.
Preserve legacy scalar config keys/reset semantics while adding explicit boundary and
active-state metadata; do not repurpose a successful config.set as proof of runtime
application. Determine old-client compatibility in the protocol slice and update Core,
Desktop and CLI consumers together. Feature unavailable, invalid candidate, failed
preparation and unknown acknowledgement must remain distinct.

Use existing subscriptions and generation fencing, not page-specific polling. After
reconnect, read actual state and restore drafts before displaying an applied badge.
Persisted secret values remain write-only. Progress/error text names the affected
feature and useful action without requiring users to interpret ports or env names.

## 7. Spec alignment and proof limits

Implementation must update config-store (precedence/apply metadata), connection auth
(local/native versus legacy paths), model/Memory capture, and Home/recovery contracts
alongside their code. The packaged-build rule requiring a default costume must become
a visible usable floor that also permits Home with no avatar. D24's old claim that
connection logic needs no change is superseded by the scoped local-flow requirement;
distribution remains open. Current specs are not evidence these changes already exist.

No clean-machine release, real-model call, production startup or manual acceptance was
performed during planning. Source/interface checks support this design; each execution
slice below must supply the actual runtime evidence before claiming its behavior.
