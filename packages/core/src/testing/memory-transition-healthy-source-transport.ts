/**
 * INPUT: actual Core Source upload descriptors and multipart bytes
 * OUTPUT: validated synthetic sealed bodies with measurable uploads and programmable ACK loss
 * POS: core/testing — no network or model requests
 */
import type { HindsightTransitionSourceClient } from "../memory/hindsight/hindsight-transition-source-client.ts";
import { decodeHindsightApplicationBody, hindsightApplicationHash, hindsightApplicationBytesHash,
  type HindsightApplicationBody } from "../memory/hindsight/hindsight-application-integrity.ts";

export function createHealthySourceTransport(input: { available(): void; sealed(): void }) {
  const bodies = new Map<string, HindsightApplicationBody>();
  const parts = new Map<string, Map<number, string>>(); const calls = { prepare: 0, part: 0, seal: 0 };
  const client: HindsightTransitionSourceClient = {
    uploadTransitionSourceBody: async ({ bankId, request }) => {
      input.available(); calls.prepare++;
      const bodyId = request.descriptor.body_id; const saved = parts.get(bodyId) ?? new Map<number, string>(); parts.set(bodyId, saved);
      return { namespace: request.namespace, bank_id: bankId, descriptor: request.descriptor,
        state: bodies.has(bodyId) ? "sealed" : "uploading", received_parts: saved.size, expires_at: null };
    },
    putTransitionSourcePart: async ({ bankId, bodyId, partNumber, request }) => {
      input.available(); calls.part++;
      const previous = parts.get(bodyId)!.get(partNumber); const bytes = Buffer.from(request.data_base64, "base64");
      if (previous && previous !== request.data_base64 || hindsightApplicationBytesHash(bytes) !== request.part_sha256) throw new Error("fixture part integrity");
      parts.get(bodyId)!.set(partNumber, request.data_base64);
      const part = { namespace: request.namespace, bank_id: bankId, body_id: bodyId, part_number: partNumber,
        part_sha256: request.part_sha256, total_bytes: bytes.length };
      return { ...part, part_hash: hindsightApplicationHash({ bankId, namespace: request.namespace, domain: "part", value: part }) };
    },
    sealTransitionSourceBody: async ({ bankId, request }) => {
      input.available(); calls.seal++;
      const saved = parts.get(request.descriptor.body_id)!;
      const bytes = Buffer.concat(Array.from({ length: request.descriptor.total_parts }, (_, index) => Buffer.from(saved.get(index)!, "base64")));
      bodies.set(request.descriptor.body_id, decodeHindsightApplicationBody({ bankId, namespace: request.namespace, ref: request.descriptor, bytes }));
      input.sealed(); return request.descriptor;
    },
  };
  return { client, bodies, calls };
}
