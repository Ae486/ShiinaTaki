# Accepted Perception Evidence

## 1. Scope / Trigger

Use this contract when changing foreground Sampling, ambient screening/capture/native consumption, Privacy Pause,
capability route provenance, or a consumer of native presence evidence. It implements the accepted-evidence
portion of [C2](../../tasks/09-11-initiative-presence-feedback/design.md). The existing
[ambient privacy contract](agent-runtime.md#ambient-observation-two-privacy-layers-fail-closed-silent-when-off-t3b)
and [Host lifecycle](host-operation-lifecycle.md) still apply.

The owner is `packages/core/src/perception/perception-evidence.ts`, composed once by `perception-layer.ts`.
It owns process-local validity and one latest accepted sample. It does not acquire another sensor, grant a
Capability, wake a model, persist a new consent authority, or associate a Node with an operator device.

## 2. Signatures

These are Core-only contracts, not operator-supplied or serialized wire fields:

```ts
interface CapabilityRouteProvenance {
  readonly hostId: string;
  readonly connectionGeneration: number;
  readonly catalogGeneration: number;
  isCurrent(): boolean;
}

type PerceptionSource = Pick<CapabilityRouteProvenance,
  "hostId" | "connectionGeneration" | "catalogGeneration">;

interface AcceptedForegroundEvidence {
  observationEpoch: number;
  observedAt: number;
  idleSeconds: number | null;
  source: PerceptionSource;
}

interface PerceptionEvidence {
  generation(): number;
  isCurrent(epoch: number, provenance?: CapabilityRouteProvenance): boolean;
  acceptForeground(input: {
    epoch: number;
    observedAt: number;
    sample: ForegroundWindowOutput;
    provenance?: CapabilityRouteProvenance;
  }): boolean;
  latest(now: number): AcceptedForegroundEvidence | undefined;
  foreground(now: number): InitiativeForegroundFact | undefined;
  retire(): void;
  reject(): void;
  retireHost(source: Pick<PerceptionSource, "hostId" | "connectionGeneration">): void;
}
```

`createPerceptionEvidence` takes `isPaused`, `freshnessMs`, `onRetire(clearHistory)` and optional `onChange`.
`PerceptionChanges.batch(change)` groups one synchronous compound retirement into one final projection invalidation.
The successful pause-write observer batches activity/cache/evidence retirement and pause-deadline refresh. Observers
see the cleared final state once, while independent source updates and the later absolute expiry retain their own
revisions. Failed consent persistence never enters this batch. UI invalidation revision is still not a consent epoch.
`RouteResult` adds optional `provenance` only to its successful branch. Optionality preserves existing local
fixtures/consumers; production `routeCapability` mints it after sealing dispatch and returns it with success.

The Perception composition route is
`route(capability: string, input: unknown, targetHostId?: string): Promise<RouteResult>`.
`main.ts` must forward all three arguments into `routeCapability`, including `targetHostId`.

Post-capture publication uses:

```ts
observeAmbientFrame(
  deps: AmbientObservationDeps,
  frame: ImageAttachment,
  observation: { observedAt: number; isCurrent(): boolean; sourceContext?: SourceContext; release?(): void },
): Promise<void>;
```

No new database migration, external API, or environment key belongs to this evidence owner. Existing durable
`PrivacyPauseStore` remains the consent store; existing ambient enable/retention settings remain authoritative.

## 3. Contracts

### Accepted evidence and time

- Parse `ForegroundWindowOutputSchema`, reject sensitive/unavailable/malformed/refused samples, and scrub the
  window title before accepted-state publication. The schema retains integer, nonnegative, nullable idle.
- Preserve the original `idleSeconds` in accepted evidence. The legacy `ActivityEntry.idle` is a lossy UI/context
  projection: `idleSeconds === null` can coexist with `idle === false`. Never use that boolean as proof of presence.
- `observedAt` is the Core clock captured at the start of the sample attempt. A slow await does not obtain a new
  freshness timestamp on return. The evidence envelope contains no process name, title, image or operator identity.
- `latest(now)` checks live source validity, current pause and age, and returns defensive copies. The layer uses
  `freshnessMs = 2 * ACTIVITY_POLL_MS = 60_000`; future samples and ages greater than this bound are unavailable.
  A consumer may be stricter: the presence snapshot currently requires age strictly less than 60 seconds.
- A successful legacy route without provenance may maintain the old activity projection but cannot establish
  accepted native evidence. Do not synthesize provenance by looking up whichever Host is connected after an await.

### C3 accepted application continuity

`foreground(now)` is a separate title-free projection of the same sanctioned accepted samples. It emits the Shared
`InitiativeForegroundFact`: exact bounded `processName` as application, source/consent fences, a stable occurrence,
observed/start instants, nullable idle, and `meaningful`. It does not change the native-only `latest(now)` shape.

The first sample after startup, app change, refusal, privacy/source retirement or a gap is not meaningful. A second
strictly later accepted sample in the same application, Host/connection/catalog, observation epoch and known-idle
classification establishes continuity only when the inter-sample gap is strictly less than 60 seconds. Subsequent
samples retain the occurrence and original start. Window-title changes do not split application dwell, and titles
never enter this fact. Known active, known idle (180-second threshold) and unknown idle are distinct classifications;
crossing one resets dwell. Null is never translated into active. Missing/oversized app names cannot produce a fact.

Read-time freshness is strict (`age < 60 seconds`). The producer adds no sampler, timer, model call or extra privacy
invalidation; existing accepted activity and source-retirement notifications remain the data-free wake seam. Wake
Policy still owns Pattern conditions, meaningful selection, all global limits and delivery revalidation.

### Independent observation epoch and durable consent

- `observationEpoch` is independent of `PerceptionChanges.revision`, Host connection/catalog generations and any
  future wake-policy revision. It starts at zero with empty evidence on each Core process; live evidence is not
  restored from a previous process.
- A successful changed Privacy Pause write follows `store.save -> live consent -> observer -> evidence.retire`.
  A failed save leaves both the previous consent and observation epoch unchanged. A no-op write need not retire.
  The only production pause mutator caller remains the operator-only `perception.pauseSet` method.
- `retire()` increments the epoch, discards evidence/source, clears cached activity history/dwell and native screen state,
  and resets ambient refresh suppression. It does not restart a denied/stopped sampler.
- `reject()` increments the epoch and removes current evidence. For a bound current source it seals the activity
  stretch, clears native screen state and resets ambient refresh suppression while retaining prior accepted history.
  Refusal is data-free; logs/invalidations must not reveal a refused application's identity or contents.
- Explicit resume retires on its successful changed write. Automatic deadline expiry remains a timer-free pause
  read, not another consent write: the earlier pause already invalidated all pre-pause work. Both paths require
  newly accepted foreground evidence and new dwell; neither revives a cached observation or wake reason.

### Sealed Host provenance

- `routeCapability` freezes provenance from the actual dispatch: Host ID, connection generation and catalog
  generation. Its live `isCurrent()` closure checks the original socket, current catalog/descriptor, and dispatch
  governance policy generation/projection. The predicate remains live after settlement.
- `generation()` retires a previously accepted source when its provenance is no longer current. Perception card,
  prompt rendering and the native-presence getter go through this validity owner before consuming cached state.
- Host removal uses `retireHost({ hostId, connectionGeneration })`. A delayed removal callback for generation N
  must not clear generation N+1's accepted sample. A replacement source never inherits the old dwell interval.
- `composePresenceRuntime` supplies `evidence.latest(now())` as the native source and observes authenticated Host
  retirement. Native evidence may support qualified aggregate presence; it cannot contribute a same-device
  message-response interval without a separately trusted operator/Node association.

### Every asynchronous boundary and raw-frame lifetime

1. Foreground Sampling captures its epoch before routing. After the await, check stop/pause/epoch, then the returned
   provenance, before parsing, screening, scrubbing and acceptance. Stale callbacks publish nothing.
2. Ambient capture first requires a fresh cached foreground candidate, then performs a fresh permitted
   `foreground-window` screen. Recheck the attempt epoch/pause and screened source after the screen await.
3. Pin `screenshot-ambient` to the screened Host. After that await, both source predicates must remain current and
   the two Host/connection/catalog tuples must match. If either result has provenance, both must have matching
   provenance; do not combine a bound result with an unbound one.
4. Validate the screenshot before publishing it. Save the raw frame through the ambient-only store and protect its
   file from retention sweeping while pending/in-use. Publish exactly one latest native frame with the original
   observation timestamp and source predicate; capture performs no model call.
5. `ScreenContext.latest(now)` exposes only `{key, at}`. `acquire(key?)` gives one `NativeImageContext` for the same
   Attempt; images/callbacks never enter persisted selected context or Timeline. A selected accepted-screen purpose
   captures the exact key before awaited Memory preparation and cannot acquire a replacement frame afterward.
6. Check live source/consent/expiry before acquisition and each actual provider dispatch. Replacement, expiry,
   withdrawal or consumption invalidates the carrier, releases GC protection and clears its in-memory pixels.
   Agent finally releases after success/failure/cancellation; preparation refusal also releases before Agent entry.
   A trusted extension ambient sidecar release can transfer into the frame lifetime; failed publication releases
   before returning, while normal publication releases together with frame consumption/retirement.
   A native frame cannot authorize a replacement Attempt or be revived from disk.
7. Env retention `drop` maps to `drop-after-consumption`: retain only until consumption/expiry/replacement/withdrawal.
   `keep`/N-days preserve completed captures under their existing policy. Source/consent withdrawal deletes a live
   frame even under retained policies. UUID-suffixed names prevent concurrent ambient/viewing capture overwrite;
   old timestamp-only names remain recognized. Boot drop sweeping clears unprotected leftovers even with future
   mtimes; periodic sweeps must not delete protected pending/in-use frames. Retention grants no observation validity.
8. The separate semantic translator and `SENSITIVE_SCREEN` sentinel are removed. The main model now sees permitted
   pixels and receives concise private-screen abstention guidance in the same normal decision. Deterministic
   process screening remains, but the old pre-main semantic suppression guarantee is not preserved. No separate
   classifier or response-buffering privacy framework is introduced. Retirement cannot retract pixels already sent.

**D48 remains open:** foreground screening and screenshot capture are separate Host round trips. Pinning Host and
checking generations prevent stale/cross-Host use but cannot make those operations atomic. Session idle is neither
physical-HID proof nor proof of reading; successful capture/model interpretation is not message presentation.

## 4. Validation & Error Matrix

| Input/event | Required result |
| --- | --- |
| Valid current sample with `idleSeconds: null` | Accept nullable evidence; no active-user claim from `idle === false` |
| Legacy success without provenance | Activity compatibility only; native evidence remains unavailable |
| Sensitive, unavailable, malformed or failed foreground result | No accepted replacement; retire eligibility and prevent old live dwell reuse |
| Pause already active | Skip routing; no sampling approval/capture/model work |
| Pause then resume/expiry during foreground, screen or screenshot await | Old epoch cannot publish or become fresh again |
| Pause/resume durable save fails | Propagate the failure; leave prior consent/epoch intact |
| Accepted Host/socket/catalog/dispatch policy becomes stale | Read-time retirement clears evidence and dependent cache |
| Old Host removal callback after a replacement sample | Match connection generation; leave replacement evidence intact |
| Fresh screen is sensitive, denied or unscreenable | No screenshot; reject current evidence; denial stops ambient sampling for the session |
| Screenshot source absent/mismatched, stale or malformed | No native publication; never repair the identity from a later Host lookup |
| Native frame source retires while pending/in-use | No later model dispatch; discard live raw frame under every retention mode |
| `now < observedAt` or native evidence is too old | Return unavailable, not absence or a fresh sample |

Route failure codes retain their existing meanings (`NO_NODE`, `TARGET_HOST_REQUIRED`, `CAPABILITY_MISSING`, broker
failures). Stale evidence is locally discarded; do not invent a successful sample or a new external error protocol.

## 5. Good / Base / Bad Cases

- Good: Host A generation 1 produced a valid sample. It reconnects as generation 2; the next read retires the old
  evidence, the next accepted sample starts dwell at one, and late generation 1 removal cannot erase it.
- Base: permitted foreground reports null idle. Activity still displays its accepted application context, while
  native presence remains unknown. Direct operator input can independently establish presence under its own contract.
- Bad: pausing and resuming while a capture runs makes its old frame publish because the final pause boolean
  is false, or `keep` retention preserves that retired in-flight frame.

## 6. Tests Required

- `perception/perception-evidence.test.ts`: real layer composition with fake time and an isolated ambient directory;
  assert nullable idle/defensive copies, legacy/future/stale refusal, sensitive/refused/malformed/unavailable
  retirement, fresh dwell after refusal, pause/resume/expiry during await, durable write ordering/failure, cache
  retirement, Host/catalog replacement, old Host cleanup isolation, both ambient await stages and native main-dispatch lifetime, Host-pinned
  screenshot routing and retired frame deletion under `keep`.
- `capabilities/route-capability.test.ts`: explicit multi-Host routing, ambiguous/no-target refusal, original
  pre-await binding and currentness that changes after replacement/removal even after the route has settled.
- `perception/privacy-pause-writer.test.ts`: resolve the called TypeScript declaration, so only actual `PrivacyPause`
  mutators count. An unrelated delivery `resume()` is not a consent writer. Keep the non-vacuous whole-tree guard.
- Existing activity, foreground-screen, ambient-screenshot, screen-context and privacy-pause suites must retain
  cadence, fail-closed screening, source fencing, retention, off-state and single-writer coverage.

These deterministic tests do not establish native window exposure, same-device association, physical input,
real-provider behavior or owner acceptance. C2's native/feedback gates remain separate.

## 7. Wrong vs Correct

```ts
// Wrong: a false pause flag after the await misses pause+resume in between.
const result = await route("foreground-window", {});
if (!pause.isPaused()) publishAsPresent(result);

// Correct: capture the independent epoch and preserve the actual successful dispatch source.
const epoch = evidence.generation();
const observedAt = now();
const result = await route("foreground-window", {});
if (!result.ok || !evidence.isCurrent(epoch, result.provenance)) return;
// First schema-validate, process-screen and scrub the result at the existing sense seam.
evidence.acceptForeground({ epoch, observedAt, sample, provenance: result.provenance });
```

The correct snippet shows the lifetime boundary only; `sample` denotes the already validated/screened/scrubbed
sample. Native-presence consumers use `evidence.latest(now())`, never `activity.current()?.idle === false`.
