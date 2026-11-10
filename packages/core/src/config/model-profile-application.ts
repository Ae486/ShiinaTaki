/**
 * INPUT: grouped profile status and scalar configuration application observations
 * OUTPUT: truthful active scalar model identity and readiness invalidations
 * POS: core/config — compatibility projection only; grouped profiles remain the sole model authority
 */
import type { ConfigApplicationTracker } from "./config-application.ts";
import type { ModelProfileService } from "./model-profile-service.ts";

export function observeModelProfileApplication(models: ModelProfileService, application: ConfigApplicationTracker): void {
  for (const profile of models.list().profiles) {
    const prefix = profile.slot === "main" ? "TAKI_PROVIDER_" : "TAKI_UTILITY_";
    const binding = models.binding(profile.slot);
    const state = profile.applicationState === "failed" ? "failed" : profile.applicationState === "draft" ? "draft"
      : profile.state === "invalid" || profile.state === "unconfigured" ? "unavailable" : "applied";
    for (const [suffix, activeValue] of [["BASE_URL", binding?.baseUrl ?? null], ["MODEL", binding?.modelId ?? null], ["API_KEY", null]] as const) {
      application.mark([prefix + suffix], state, { activeValue,
        message: profile.issues[0] ?? (state === "draft" ? "Draft saved; active profile retained." : undefined) });
    }
  }
}
