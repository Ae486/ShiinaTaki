/**
 * INPUT:  complete Local/application originals, including legal JSON keys and escaped lone UTF-16 code units
 * OUTPUT: deterministic lossless W3 semantic hashes independent of the more restrictive PostgreSQL native codec
 * POS:    core/memory/transitions — internal evidence encoding; W2 wire signatures keep their original native codec
 */
import { createHash } from "node:crypto";
import { hindsightApplicationTaggedJson } from "@taki/shared";

export function transitionLocalHash(value: unknown): string {
  return createHash("sha256").update(hindsightApplicationTaggedJson(value)).digest("hex");
}
