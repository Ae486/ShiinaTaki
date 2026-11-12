/**
 * INPUT: immutable inbox action results retained by their original owner
 * OUTPUT: useful result evidence without internal persistence identifiers and digests
 * POS: core/db — read projection shared by recovery instructions and paged model inspection
 */
export function subagentActionEvidence(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => ![
    "inputId", "receiptId", "actionId", "consumerId", "modelEffectId", "invocationId", "requestDigest", "actionDigest", "bodyDigest",
  ].includes(key)));
}
