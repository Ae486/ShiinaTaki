/**
 * INPUT: authenticated operator RPC seam and Shared presence/presentation schemas
 * OUTPUT: validated source reports and committed Timeline exposure reports
 * POS: ui/lib — bounded evidence facade; no input content, device assertion or message ACK
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { PRESENCE_METHODS, PresenceReportResultSchema, PresenceSnapshotSchema, type PresenceReportParams,
  type TimelinePresentationReportParams } from "@taki/shared";

export function presenceMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    presenceReport: async (params: PresenceReportParams) => PresenceReportResultSchema.parse(await request(PRESENCE_METHODS.report, params)),
    presenceRead: async () => PresenceSnapshotSchema.parse(await request(PRESENCE_METHODS.read, {})),
    timelinePresentationReport: async (params: TimelinePresentationReportParams) =>
      PresenceReportResultSchema.parse(await request(PRESENCE_METHODS.presentationReport, params)),
  };
}
export type PresenceMethods = ReturnType<typeof presenceMethods>;
