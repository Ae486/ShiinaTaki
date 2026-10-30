/**
 * INPUT: authenticated operator request seam and Shared timezone contracts
 * OUTPUT: parsed singleton reads, explicit settings updates and designated-source reports
 * POS: ui/lib — timezone facade; no local persistence or automatic mutation replay
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { USER_TIMEZONE_METHODS, UserTimezoneReadResultSchema, UserTimezoneMutationResultSchema,
  type UserTimezoneReadParams, type UserTimezoneUpdateParams, type UserTimezoneReportParams } from "@taki/shared";

export function userTimezoneMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    userTimezoneRead: async (params: UserTimezoneReadParams = {}) =>
      UserTimezoneReadResultSchema.parse(await request(USER_TIMEZONE_METHODS.read, params)),
    userTimezoneUpdate: async (params: UserTimezoneUpdateParams) =>
      UserTimezoneMutationResultSchema.parse(await request(USER_TIMEZONE_METHODS.update, params)),
    userTimezoneReport: async (params: UserTimezoneReportParams) =>
      UserTimezoneMutationResultSchema.parse(await request(USER_TIMEZONE_METHODS.report, params)),
  };
}
export type UserTimezoneMethods = ReturnType<typeof userTimezoneMethods>;
