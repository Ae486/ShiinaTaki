/**
 * INPUT:  a private stdin byte stream and finite caller budget
 * OUTPUT: one strict UTF-8 JSON value after EOF, refusing oversize or unfinished input
 * POS:    hindsight-host — bounded private control framing only; never provider secrets or a public listener
 */
import type { Readable } from "node:stream";
import { HINDSIGHT_CUSTODY_LIMITS } from "@taki/shared/hindsight-custody";
import { CustodyError } from "./custody-error.ts";

export async function readControlInput(input: Readable, signal: AbortSignal): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const stop = () => input.destroy(new CustodyError("outcome-unknown"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    if (signal.aborted) throw new CustodyError("outcome-unknown");
    for await (const item of input) {
      const bytes = Buffer.from(item as Uint8Array);
      size += bytes.length;
      if (size > HINDSIGHT_CUSTODY_LIMITS.requestBytes) throw new CustodyError("input-oversize");
      chunks.push(bytes);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
