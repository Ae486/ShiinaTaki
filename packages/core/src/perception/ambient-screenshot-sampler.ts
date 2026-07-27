/**
 * INPUT:  a route fn (partial-applied routeCapability), a per-capability hasNode / isPaused / isSensitive predicates,
 *         the CURRENT foreground entry the T3a sampler recorded, an optional VLM describe bridge, an AmbientShotStore
 *         + a ScreenContext sink, a Logger, cadence/retention config
 * OUTPUT: createAmbientScreenshotSampler(deps) -> { start, stop, running }; the ambient screen poll, DEFAULT OFF
 * POS:    core/perception — the HIGH-SENSITIVITY sibling of activity-sampler: capture → Gate (`screenshot-ambient`,
 *         its own grant) → VLM describe (which doubles as the semantic privacy screen) → PII scrub → screen context
 *         (fenced at render). Two independent gates must both open: the enable flag decides whether the loop is
 *         scheduled AT ALL (off = zero captures, zero dialogs, zero logs), the Gate cell decides each capture.
 *         Never throws; a denied grant stops it for the session.
 */
import { ScreenshotOutputSchema } from "@taki/shared";
import type { RouteFailureCode, RouteResult } from "../capabilities/route-capability.ts";
import type { Logger } from "../logging/logger.ts";
import type { AmbientShotStore } from "./ambient-shot-store.ts";
import { foregroundKey, screenForegroundNow, FOREGROUND_CAPABILITY } from "./foreground-screen.ts";
import { scrubPii } from "./pii-scrub.ts";
import type { ScreenContext } from "./screen-context.ts";
import { AMBIENT_DESCRIBE_FOCUS, isSensitiveScreenVerdict } from "./sensitive-screen.ts";

const CAPABILITY = "screenshot-ambient";
// Both refusals of the final screen, worded so neither discloses what it refused to look at.
const SENSITIVE_SKIP = "sensitive foreground app; ambient capture skipped";
const UNSCREENABLE_SKIP = "live foreground could not be screened; ambient capture skipped";

export interface AmbientScreenshotSamplerConfig {
  /** The ambient switch (env today, panel at #26). False = the loop is never scheduled — Recall's silent off-state. */
  enabled: boolean;
  /** Base poll cadence: how often the loop CONSIDERS a capture (a tick usually decides not to). */
  pollMs: number;
  /** Re-describe the same window after this long, so the screen block never silently goes stale under a still user. */
  refreshMs: number;
  /** A foreground sample older than this is treated as UNKNOWN — fail-closed, no capture (see captureTarget). */
  foregroundMaxAgeMs: number;
  /** Retention `drop-after-describe`: delete the raw frame the moment its description exists (factory default). */
  dropRawAfterDescribe: boolean;
  errorBackoffThreshold: number;
  maxBackoffMs: number;
}

/** The foreground the T3a sampler last recorded; observedAt is when that sample was taken (freshness, not start). */
export interface AmbientForeground {
  processName: string;
  windowTitle: string;
  observedAt: number;
}

export interface AmbientScreenshotSamplerDeps {
  route: (capability: string, input: unknown) => Promise<RouteResult>;
  /** True iff a node currently provides `capability`; asked for BOTH the capture and its pre-capture foreground screen. */
  hasNode: (capability: string) => boolean;
  isPaused: () => boolean;
  isSensitive: (processName: string | null) => boolean;
  foreground: () => AmbientForeground | undefined;
  /** The vision slot's describe bridge; absent = no VLM, so the loop never starts (pixels with no text are pure cost). */
  describe?: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
  store: AmbientShotStore;
  context: ScreenContext;
  logger: Logger;
  config: AmbientScreenshotSamplerConfig;
  /** Injected epoch-ms clock (defaults to Date.now); tests pass a synthetic clock. */
  now?: () => number;
}

export interface AmbientScreenshotSampler {
  start(): void;
  stop(): void;
  /** True while the loop is scheduled — false when never enabled, degraded (no vision slot), stopped or denied. */
  running(): boolean;
}

// One context so the tick/decision logic lives at module scope (function size cap), mirroring activity-sampler.
interface AmbientRuntime {
  deps: AmbientScreenshotSamplerDeps;
  log: Logger;
  now: () => number;
  timer: ReturnType<typeof setInterval> | undefined;
  stopped: boolean;
  inflight: boolean;
  consecutiveErrors: number;
  backoffUntil: number;
  offlineLogged: boolean;
  pausedLogged: boolean;
  skipLogged: boolean;
  /** The final pre-capture screen keeps its OWN log-once streak: it runs far more rarely than the cheap pre-filter. */
  screenLogged: boolean;
  /** The foreground identity of the last successful capture + when it happened (change/refresh decision). */
  lastKey: string | undefined;
  lastCaptureAt: number;
}

function logOnce(rt: AmbientRuntime, flag: "skipLogged" | "screenLogged", message: string): void {
  if (rt[flag]) return;
  rt.log.debug(message);
  rt[flag] = true;
}

/**
 * The cheap PRE-FILTER over the foreground T3a recorded: false here means we never route at all. It decides WHETHER a
 * capture is worth considering, never that one is SAFE — screenNow() has the last word, because this entry is one poll
 * old by construction. Three guards, in privacy order:
 * 1. UNKNOWN or STALE foreground -> skip. Fail-closed: with no recent sample (T3a paused, denied, offline, or it
 *    SEALED the state on a sensitive app) we cannot tell what has been on screen, and a capture we cannot screen is
 *    exactly the one to refuse.
 * 2. SENSITIVE app -> skip (prd ruling 4; the process name is never logged — that would re-leak the observation).
 * 3. UNCHANGED window, not yet due for a refresh -> skip. Event-driven capture (research R2/[SP-INTRO]): describing
 *    the same window every tick is ~10x the VLM cost for no new information.
 */
function captureTarget(rt: AmbientRuntime, at: number): boolean {
  const { config, isSensitive, foreground } = rt.deps;
  const current = foreground();
  if (current === undefined || at - current.observedAt > config.foregroundMaxAgeMs) {
    logOnce(rt, "skipLogged", "foreground unknown or stale; ambient capture skipped");
    return false;
  }
  if (isSensitive(current.processName)) {
    logOnce(rt, "skipLogged", SENSITIVE_SKIP);
    return false;
  }
  rt.skipLogged = false;
  const key = foregroundKey(current.processName, current.windowTitle);
  return key !== rt.lastKey || at - rt.lastCaptureAt >= config.refreshMs;
}

function stop(rt: AmbientRuntime): void {
  rt.stopped = true;
  if (rt.timer) {
    clearInterval(rt.timer);
    rt.timer = undefined;
  }
}

function handleFailure(rt: AmbientRuntime, code: RouteFailureCode, at: number): void {
  if (code === "NO_NODE") {
    if (!rt.offlineLogged) {
      rt.log.info({ code }, "no device provides screenshot-ambient; ambient sampler idle until one connects");
      rt.offlineLogged = true;
    }
    return;
  }
  if (code === "DENIED") {
    // The user denied (or let the single dialog time out): stop for the session — ask-over-poll etiquette, at most
    // ONE ambient dialog per session, and a refusal is respected quietly (no per-tick re-prompt).
    rt.log.info({ code }, "ambient screen capture denied; stopping the ambient sampler for this session");
    stop(rt);
    return;
  }
  rt.consecutiveErrors += 1;
  const { errorBackoffThreshold, maxBackoffMs, pollMs } = rt.deps.config;
  if (rt.consecutiveErrors >= errorBackoffThreshold) {
    const steps = rt.consecutiveErrors - errorBackoffThreshold;
    const backoff = Math.min(maxBackoffMs, pollMs * 2 ** (steps + 1));
    rt.backoffUntil = at + backoff;
    rt.log.warn({ code, consecutiveErrors: rt.consecutiveErrors, backoffMs: backoff }, "ambient sampler backing off");
  }
}

/**
 * Persist → describe → screen → scrub → publish. The frame is written BEFORE the describe so a crash mid-description
 * leaves a file the retention sweeper can reclaim; under drop-after-describe it is deleted the moment the description
 * exists (or fails). The describe call carries the privacy focus (sensitive-screen.ts) — privacy layer TWO, which sees
 * inside a browser as an exe-name skip cannot. Scrub-then-fence (prd ruling 5): PII leaves the description HERE, at
 * the sense seam, so the prompt path (fenced by screen-context's renderer) only ever carries the minimized string.
 */
async function observe(rt: AmbientRuntime, frame: { dataBase64: string; mediaType: string }, at: number): Promise<void> {
  const describe = rt.deps.describe;
  if (describe === undefined) return; // unreachable: start() refuses to schedule without a describe bridge
  const { dataBase64, mediaType } = frame;
  const saved = rt.deps.store.save(dataBase64, at);
  const description = await describe({ dataBase64, mediaType, prompt: AMBIENT_DESCRIBE_FOCUS });
  const sensitive = description !== null && isSensitiveScreenVerdict(description);
  // A sensitive verdict overrides the retention config: the one frame we must never keep is the one the model just
  // told us not to look at.
  if (saved !== null && (sensitive || rt.deps.config.dropRawAfterDescribe)) rt.deps.store.discard(saved.name);
  if (sensitive) {
    // Neither the description nor the window identity may appear here — logging them would re-leak what the refusal
    // protects. The previous observation stays: blanking the block would itself signal "something private is up now".
    rt.log.debug("ambient screen judged sensitive by the vision pass; frame and description discarded");
    return;
  }
  if (description === null) return; // the describer already warned; keep the previous observation rather than a blank
  rt.deps.context.push(scrubPii(description), at);
}

/**
 * The FINAL gate, as late as possible: one fresh foreground-window route immediately before the capture, so the
 * decision rests on what is in front NOW, not on the entry T3a recorded a poll ago. Returns the identity to record,
 * or undefined to skip; fail-closed on everything it cannot read. NOT atomic — the user can still switch between this
 * reply and the capture's, which is D48's remaining residual (one round-trip, down from one poll interval).
 */
async function screenNow(rt: AmbientRuntime): Promise<string | undefined> {
  const screened = await screenForegroundNow({ route: rt.deps.route, isSensitive: rt.deps.isSensitive });
  if (screened.status === "clear") {
    rt.screenLogged = false;
    return screened.key;
  }
  if (screened.status === "denied") {
    // Without a fresh foreground this sampler can never satisfy its safety precondition again, so continuing would
    // mean ticking forever only to skip forever — stop, exactly as a denial of its own capability does.
    rt.log.info({ code: "DENIED" }, "foreground screening denied; stopping the ambient sampler for this session");
    stop(rt);
    return undefined;
  }
  logOnce(rt, "screenLogged", screened.status === "sensitive" ? SENSITIVE_SKIP : UNSCREENABLE_SKIP);
  return undefined;
}

async function capture(rt: AmbientRuntime, key: string, at: number): Promise<void> {
  const routed = await rt.deps.route(CAPABILITY, {});
  if (!routed.ok) {
    handleFailure(rt, routed.code, at);
    return;
  }
  rt.consecutiveErrors = 0;
  rt.backoffUntil = 0;
  rt.offlineLogged = false;
  const parsed = ScreenshotOutputSchema.safeParse(routed.output);
  if (!parsed.success) {
    rt.log.warn({ code: "MALFORMED_SAMPLE" }, "ambient capture failed schema; skipping tick");
    return;
  }
  // The FRESH identity is what gets recorded (never the pre-filter's assumption) and it is recorded BEFORE the
  // description: a failing VLM must not turn every tick into a new capture — the refresh window is the retry.
  rt.lastKey = key;
  rt.lastCaptureAt = at;
  await observe(rt, parsed.data, at);
}

async function tick(rt: AmbientRuntime): Promise<void> {
  if (rt.stopped || rt.inflight) return;
  const at = rt.now();
  if (at < rt.backoffUntil) return; // still inside a backoff window
  if (rt.deps.isPaused()) {
    if (!rt.pausedLogged) {
      rt.log.info("privacy pause active; ambient screen sampling suspended");
      rt.pausedLogged = true;
    }
    return;
  }
  rt.pausedLogged = false;
  if (!captureTarget(rt, at)) return;
  // Pre-flights (activity-sampler precedent): with no node providing a capability, routing would log a per-tick "tool
  // invoked" + NO_NODE pair. Skip it and take the same quiet once-per-streak arm — and no node for the final screen
  // is a refusal like any other.
  if (!rt.deps.hasNode(CAPABILITY)) {
    handleFailure(rt, "NO_NODE", at);
    return;
  }
  if (!rt.deps.hasNode(FOREGROUND_CAPABILITY)) {
    logOnce(rt, "screenLogged", UNSCREENABLE_SKIP);
    return;
  }
  rt.inflight = true;
  try {
    const key = await screenNow(rt);
    if (key === undefined) return;
    await capture(rt, key, at);
  } catch (error) {
    // Defense-in-depth: routeCapability and the describer never throw, but the loop must survive any surprise.
    const message = error instanceof Error ? error.message : String(error);
    rt.log.warn({ err: message }, "ambient sampler tick threw; skipping");
  } finally {
    rt.inflight = false;
  }
}

export function createAmbientScreenshotSampler(deps: AmbientScreenshotSamplerDeps): AmbientScreenshotSampler {
  const rt: AmbientRuntime = {
    deps,
    log: deps.logger.child({ mod: "ambient-screen" }),
    now: deps.now ?? Date.now,
    timer: undefined,
    stopped: false,
    inflight: false,
    consecutiveErrors: 0,
    backoffUntil: 0,
    offlineLogged: false,
    pausedLogged: false,
    skipLogged: false,
    screenLogged: false,
    lastKey: undefined,
    lastCaptureAt: Number.NEGATIVE_INFINITY,
  };
  return {
    start() {
      // Gate 1 — DEFAULT OFF (prd ruling 1): not scheduled means no capture, no approval dialog and NO log line
      // either. An "ambient sampling disabled" line every boot would itself advertise a feature the user never
      // enabled; Recall's off-state is fully silent.
      if (!deps.config.enabled) return;
      if (!deps.describe) {
        // Degrade, do not spin: a capture with no vision slot to describe it is pure cost and pure risk.
        rt.log.info("no vision slot configured; ambient screen sampling stays off");
        return;
      }
      if (rt.timer || rt.stopped) return;
      rt.timer = setInterval(() => void tick(rt), deps.config.pollMs);
      rt.timer.unref();
    },
    stop: () => stop(rt),
    running: () => rt.timer !== undefined && !rt.stopped,
  };
}
