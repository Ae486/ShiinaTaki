import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CopyStreamDecoder } from "./hindsight-candidate-copy-stream.ts";

// Fixed protocol vector, independent of the candidate fixture encoder: 2 fields, text "a" and NULL.
const VECTOR = Buffer.from("5047434f50590aff0d0a00" + "00000000" + "00000000" + "00020000000161ffffffffffff", "hex");
const tuple = Buffer.from("00020000000161ffffffff", "hex");
const expected = createHash("sha256").update(createHash("sha256").update(tuple).digest()).digest("hex");

describe("PostgreSQL binary COPY tuple inventory", () => {
  it("accepts every split of a fixed protocol vector and hashes exactly its tuple bytes", () => {
    for (let offset = 0; offset <= VECTOR.length; offset++) {
      const decoder = new CopyStreamDecoder({ fields: 2, collect: 0, required: [0] });
      decoder.push(VECTOR.subarray(0, offset)); decoder.push(VECTOR.subarray(offset));
      expect(decoder.finish()).toEqual({ rows: 1, rowsDigest: expected, values: ["a"] });
    }
  });
  it("retains NULL vs empty and duplicate multiplicity while ignoring row order", () => {
    const header = VECTOR.subarray(0, 19); const end = Buffer.from("ffff", "hex");
    const other = Buffer.from("00020000000000000000", "hex");
    const decode = (rows: Buffer[]) => { const d = new CopyStreamDecoder({ fields: 2 }); d.push(Buffer.concat([header, ...rows, end])); return d.finish(); };
    expect(decode([tuple, other])).toEqual(decode([other, tuple]));
    expect(decode([tuple, tuple]).rowsDigest).not.toBe(decode([tuple]).rowsDigest);
    expect(decode([tuple]).rowsDigest).not.toBe(decode([other]).rowsDigest);
  });
  it("rejects unsupported flags, bad counts, illegal lengths, trailing bytes and every truncation", () => {
    const bad = [Buffer.concat([VECTOR, Buffer.from([0])])];
    const flags = Buffer.from(VECTOR); flags.writeUInt32BE(0x10000, 11); bad.push(flags);
    const count = Buffer.from(VECTOR); count.writeInt16BE(1, 19); bad.push(count);
    const length = Buffer.from(VECTOR); length.writeInt32BE(-2, 21); bad.push(length);
    for (let end = 0; end < VECTOR.length; end++) bad.push(VECTOR.subarray(0, end));
    for (const bytes of bad) expect(() => { const d = new CopyStreamDecoder({ fields: 2 }); d.push(bytes); d.finish(); }).toThrow("COPY_STREAM_INVALID");
  });
  it("skips header extensions and noncritical flags but enforces required bodies and constructor bounds", () => {
    const header = Buffer.from(VECTOR.subarray(0, 19)); header.writeInt32BE(3, 15); header.writeUInt32BE(1, 11);
    const d = new CopyStreamDecoder({ fields: 2 }); d.push(Buffer.concat([header, Buffer.from([1, 2, 3]), VECTOR.subarray(19)]));
    expect(d.finish().rowsDigest).toBe(expected);
    expect(() => { const d = new CopyStreamDecoder({ fields: 2, required: [1] }); d.push(VECTOR); }).toThrow("COPY_STREAM_INVALID");
    for (const fields of [0, -1, 1.5, 32768]) expect(() => new CopyStreamDecoder({ fields })).toThrow();
    expect(() => new CopyStreamDecoder({ fields: 2, collect: 2 })).toThrow();
    expect(() => new CopyStreamDecoder({ fields: 2, required: [-1] })).toThrow();
  });
});
