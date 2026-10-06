/**
 * INPUT:  one exact SQLite row including binary columns
 * OUTPUT: typed canonical row digest without embedding source or credential contents in reports
 * POS:    core/db — shared emergency snapshot and held-effect identity
 */
import { createHash } from "node:crypto";
import type { SqlRow } from "./sqlite.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";

export function emergencyRowHash(row: SqlRow): string {
  return transitionLocalHash(Object.keys(row).sort().map((key) => {
    const value = row[key];
    if (value instanceof Uint8Array) return [key, "blob", value.byteLength, createHash("sha256").update(value).digest("hex")];
    return [key, typeof value, value];
  }));
}
