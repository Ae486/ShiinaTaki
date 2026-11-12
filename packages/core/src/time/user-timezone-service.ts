/**
 * INPUT: authenticated operator commands, singleton repository and the existing schedule service
 * OUTPUT: validated persisted User Timezone, CAS refusals and atomic future schedule recomputation
 * POS: core/time — timezone domain authority; device/connection authentication stays in the method boundary
 */
import {
  UserTimezoneUpdateParamsSchema, UserTimezoneReportParamsSchema, UserTimezoneStateSchema,
  type UserTimezoneMutationResult, type UserTimezoneState, type UserTimezoneUpdateParams,
  type UserTimezoneReportParams,
} from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { UserTimezoneRepo } from "../db/user-timezone-repo.ts";
import type { ScheduledTaskService } from "../scheduler/scheduled-task-service.ts";
import type { Logger } from "../logging/logger.ts";
import { startOfUserDay } from "./time-context.ts";

export interface UserTimezoneService {
  read(): UserTimezoneState;
  timezone(): string;
  dayStart(at?: Date): string;
  update(candidate: UserTimezoneUpdateParams, actorDeviceId: string): UserTimezoneMutationResult;
  report(candidate: UserTimezoneReportParams, actorDeviceId: string): UserTimezoneMutationResult;
}

interface Dependencies {
  db: Database;
  repo: UserTimezoneRepo;
  schedules: Pick<ScheduledTaskService, "recomputeUserTimezone">;
  isOperatorDevice: (deviceId: string) => boolean;
  logger: Pick<Logger, "warn">;
  now?: () => Date;
  onEffectiveZoneChange?: (state: UserTimezoneState, previous: UserTimezoneState) => void;
  onChanged?: () => void;
}

export function createUserTimezoneService(input: Dependencies): UserTimezoneService {
  const now = input.now ?? (() => new Date());
  const commit = (before: UserTimezoneState, state: UserTimezoneState): UserTimezoneMutationResult => {
    let accepted = false;
    input.db.transaction(() => {
      accepted = input.repo.replace(state, before.revision);
      if (accepted && before.timezone !== state.timezone) {
        input.schedules.recomputeUserTimezone(state.timezone, new Date(state.updatedAt));
      }
    });
    if (!accepted) return { status: "refused", reason: "revision-conflict", state: input.repo.read() };
    publishTimezoneChange(input, before, state);
    return { status: "accepted", state };
  };
  return {
    read: () => input.repo.read(),
    timezone: () => input.repo.read().timezone,
    dayStart: (at = now()) => startOfUserDay(at, input.repo.read().timezone),
    update(candidate, actorDeviceId) {
      const value = UserTimezoneUpdateParamsSchema.parse(candidate);
      const before = input.repo.read();
      if (value.expectedRevision !== before.revision) return { status: "refused", reason: "revision-conflict", state: before };
      if (value.mode === "follow-primary-device" && !input.isOperatorDevice(value.authorityDeviceId)) {
        return { status: "refused", reason: "unknown-authority", state: before };
      }
      const at = now().toISOString();
      const selection = value.mode === "fixed"
        ? { timezone: value.timezone, authorityDeviceId: null, source: "operator", sourceDeviceId: actorDeviceId, confirmedAt: at }
        : { authorityDeviceId: value.authorityDeviceId };
      return commit(before, UserTimezoneStateSchema.parse({
        ...before, ...selection, mode: value.mode, revision: before.revision + 1, updatedAt: at,
      }));
    },
    report(candidate, actorDeviceId) {
      const value = UserTimezoneReportParamsSchema.parse(candidate);
      const before = input.repo.read();
      if (before.mode === "fixed") return { status: "ignored-fixed", state: before };
      if (before.authorityDeviceId !== actorDeviceId) return { status: "refused", reason: "foreign-authority", state: before };
      if (before.revision !== value.expectedRevision) return { status: "refused", reason: "revision-conflict", state: before };
      const at = now().toISOString();
      return commit(before, UserTimezoneStateSchema.parse({
        ...before, timezone: value.timezone, source: "device", sourceDeviceId: actorDeviceId,
        confirmedAt: at, updatedAt: at, revision: before.revision + 1,
      }));
    },
  };
}

function publishTimezoneChange(input: Dependencies, before: UserTimezoneState, state: UserTimezoneState): void {
  try { input.onChanged?.(); }
  catch { input.logger.warn("User Timezone committed but a revision observer failed"); }
  if (before.timezone !== state.timezone) {
    try { input.onEffectiveZoneChange?.(state, before); }
    catch { input.logger.warn("User Timezone committed but an effective-zone observer failed"); }
  }
}
