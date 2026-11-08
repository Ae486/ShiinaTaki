/**
 * INPUT:  one PostgreSQL binary COPY stream (`<table>.bin`) in arbitrary chunks plus its pinned column count
 * OUTPUT: row count, order-independent tuple-multiset digest and, optionally, one column's non-null text values
 * POS:    core/memory/hindsight-candidates — pure streaming decoder; never buffers a whole entry, never decodes types
 */
import { createHash, type Hash } from "node:crypto";

const SIGNATURE = Buffer.from("PGCOPY\n\xff\r\n\0", "latin1");
const HEADER_BYTES = SIGNATURE.length + 8;
type State = "header" | "extension" | "count" | "length" | "data" | "done";

export interface CopyStreamStats { rows: number; rowsDigest: string; values: string[] }

/** Throws COPY_STREAM_INVALID on a bad header, field-count drift, a negative length or a truncated/extended stream. */
export class CopyStreamDecoder {
  readonly #fields: number; readonly #collect: number | null; readonly #required: ReadonlySet<number>;
  #state: State = "header"; #fixed: Buffer = Buffer.alloc(0); #need = HEADER_BYTES; #remaining = 0;
  #field = 0; #tuple: Hash | null = null; #value: Buffer[] | null = null;
  readonly #digests: Buffer[] = []; readonly #values: string[] = [];

  constructor(input: { fields: number; collect?: number; required?: readonly number[] }) {
    this.#fields = input.fields; this.#collect = input.collect ?? null;
    this.#required = new Set(input.required ?? []);
    if (!Number.isInteger(this.#fields) || this.#fields < 1 || this.#fields > 32767) invalid();
    for (const field of [...this.#required, ...(this.#collect === null ? [] : [this.#collect])]) {
      if (!Number.isInteger(field) || field < 0 || field >= this.#fields) invalid();
    }
  }

  push(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.#state === "done") invalid();
      if (this.#state === "extension" || this.#state === "data") { offset += this.#stream(chunk.subarray(offset)); continue; }
      const take = Math.min(this.#need - this.#fixed.length, chunk.length - offset);
      this.#fixed = Buffer.concat([this.#fixed, chunk.subarray(offset, offset + take)]); offset += take;
      if (this.#fixed.length === this.#need) { const bytes = this.#fixed; this.#fixed = Buffer.alloc(0); this.#onFixed(bytes); }
    }
  }

  finish(): CopyStreamStats {
    if (this.#state !== "done") invalid();
    const sorted = [...this.#digests].sort(Buffer.compare);
    return { rows: this.#digests.length, rowsDigest: createHash("sha256").update(Buffer.concat(sorted)).digest("hex"), values: this.#values };
  }

  #stream(bytes: Uint8Array): number {
    const take = Math.min(this.#remaining, bytes.length); const part = bytes.subarray(0, take);
    if (this.#state === "data") { this.#tuple!.update(part); this.#value?.push(Buffer.from(part)); }
    this.#remaining -= take;
    if (this.#remaining === 0) { if (this.#state === "data") this.#endField(); else this.#expect("count", 2); }
    return take;
  }

  #onFixed(bytes: Buffer): void {
    if (this.#state === "header") {
      if (!bytes.subarray(0, SIGNATURE.length).equals(SIGNATURE)) invalid();
      // PostgreSQL reserves the high 16 bits for format-critical flags (including the removed OID layout).
      if ((bytes.readUInt32BE(SIGNATURE.length) & 0xffff0000) !== 0) invalid();
      const extension = bytes.readInt32BE(SIGNATURE.length + 4); if (extension < 0) invalid();
      if (extension === 0) this.#expect("count", 2); else { this.#state = "extension"; this.#remaining = extension; }
    } else if (this.#state === "count") {
      const count = bytes.readInt16BE(0);
      if (count === -1) { this.#state = "done"; return; }
      if (count !== this.#fields) invalid();
      this.#tuple = createHash("sha256").update(bytes); this.#field = 0; this.#expect("length", 4);
    } else this.#onLength(bytes);
  }

  #onLength(bytes: Buffer): void {
    this.#tuple!.update(bytes); const length = bytes.readInt32BE(0);
    if (length < -1 || length === -1 && this.#required.has(this.#field)) invalid();
    this.#value = length >= 0 && this.#field === this.#collect ? [] : null;
    if (length <= 0) { this.#endField(); return; }
    this.#state = "data"; this.#remaining = length;
  }

  #endField(): void {
    if (this.#value) this.#values.push(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(this.#value)));
    this.#value = null; this.#field += 1;
    if (this.#field < this.#fields) { this.#expect("length", 4); return; }
    this.#digests.push(this.#tuple!.digest()); this.#tuple = null; this.#expect("count", 2);
  }

  #expect(state: State, bytes: number): void { this.#state = state; this.#need = bytes; }
}

function invalid(): never { throw new Error("COPY_STREAM_INVALID"); }
