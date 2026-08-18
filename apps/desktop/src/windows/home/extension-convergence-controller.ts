/**
 * INPUT:  replaceable authenticated WsClient generations and extension.status reads
 * OUTPUT: current-client-only convergence snapshots with last-good read fallback
 * POS:    Home shared operator state guard; in-memory only, with no mutation, replay, or persisted cache
 */
import type { ExtensionConvergenceResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

export type ExtensionConvergenceClient = Pick<WsClient, "extensionStatus">;
export type ExtensionConvergenceState =
  | { kind: "idle"; previous: ExtensionConvergenceResult | null }
  | { kind: "loading"; previous: ExtensionConvergenceResult | null }
  | { kind: "ready"; data: ExtensionConvergenceResult }
  | { kind: "failure"; previous: ExtensionConvergenceResult | null; message: string };

export interface ExtensionConvergenceController {
  replace(client: ExtensionConvergenceClient | null): void;
  refresh(): Promise<void>;
  dispose(): void;
}

export function createExtensionConvergenceController(
  publish: (state: ExtensionConvergenceState) => void,
): ExtensionConvergenceController {
  let client: ExtensionConvergenceClient | null = null;
  let epoch = 0;
  let token = 0;
  let lastGood: ExtensionConvergenceResult | null = null;

  async function refresh(): Promise<void> {
    const candidate = client;
    if (!candidate) return;
    const capturedEpoch = epoch;
    const capturedToken = ++token;
    publish({ kind: "loading", previous: lastGood });
    try {
      const result = await candidate.extensionStatus();
      if (!current(candidate, capturedEpoch, capturedToken)) return;
      lastGood = result;
      publish({ kind: "ready", data: result });
    } catch (error) {
      if (current(candidate, capturedEpoch, capturedToken)) {
        publish({ kind: "failure", previous: lastGood, message: readable(error) });
      }
    }
  }

  function current(candidate: ExtensionConvergenceClient, capturedEpoch: number, capturedToken: number): boolean {
    return client === candidate && epoch === capturedEpoch && token === capturedToken;
  }

  return {
    replace(next) {
      epoch += 1;
      token += 1;
      client = next;
      publish(next ? { kind: "loading", previous: lastGood } : { kind: "idle", previous: lastGood });
      if (next) void refresh();
    },
    refresh,
    dispose() {
      epoch += 1;
      token += 1;
      client = null;
    },
  };
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取扩展收敛状态";
}
