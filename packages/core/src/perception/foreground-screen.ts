/**
 * INPUT:  a route fn (partial-applied routeCapability) + the sensitive-process predicate
 * OUTPUT: screenForegroundNow(deps) -> ForegroundScreen (clear+identity | sensitive | unscreenable | denied);
 *         foregroundKey(processName, windowTitle) — the ONE foreground identity rule
 * POS:    core/perception — the FINAL gate in front of an ambient capture. The activity layer's entry is one poll old
 *         BY CONSTRUCTION (foreground and screenshot are two independent WS round-trips), so a switch made between two
 *         T3a samples is invisible to it; this routes the EXISTING foreground-window capability once, immediately
 *         before the capture, and reports what is ACTUALLY in front. Fail-closed: anything it cannot read is a refusal.
 *         Pure + OS-neutral; it names nothing to its caller beyond a verdict, so a refusal cannot re-leak the app.
 */
import { ForegroundWindowOutputSchema } from "@taki/shared";
import type { CapabilityRouteProvenance, RouteResult } from "../capabilities/route-capability.ts";
import { scrubPii } from "./pii-scrub.ts";

export const FOREGROUND_CAPABILITY = "foreground-window";

/**
 * `unscreenable` folds every unreadable outcome into ONE refusal (route failure, schema miss, no focused window, no
 * process name): the caller's only correct reaction to any of them is the same, and distinguishing them would tempt a
 * log line that discloses more than "we did not look".
 */
export type ForegroundScreen =
  | { status: "clear"; key: string; provenance?: CapabilityRouteProvenance }
  | { status: "sensitive" }
  | { status: "unscreenable" }
  | { status: "denied" };

export interface ForegroundScreenDeps {
  route: (capability: string, input: unknown) => Promise<RouteResult>;
  isSensitive: (processName: string | null) => boolean;
}

/**
 * The change-detection identity of a foreground. Shared by the ambient sampler's stale-entry pre-filter and this fresh
 * screen so the two can never drift: a NUL separator no window title can contain, and the SCRUBBED title the activity
 * sampler records (a raw title would both re-admit PII into memory and never compare equal to the stored entry).
 */
export function foregroundKey(processName: string, windowTitle: string): string {
  return `${processName}\u0000${windowTitle}`;
}

export async function screenForegroundNow(deps: ForegroundScreenDeps): Promise<ForegroundScreen> {
  const routed = await deps.route(FOREGROUND_CAPABILITY, {});
  if (!routed.ok) return { status: routed.code === "DENIED" ? "denied" : "unscreenable" };
  const parsed = ForegroundWindowOutputSchema.safeParse(routed.output);
  if (!parsed.success || !parsed.data.available || parsed.data.processName === null) return { status: "unscreenable" };
  const { processName, windowTitle } = parsed.data;
  if (deps.isSensitive(processName)) return { status: "sensitive" };
  return { status: "clear", key: foregroundKey(processName, scrubPii(windowTitle ?? "")), ...(routed.provenance ? { provenance: routed.provenance } : {}) };
}
