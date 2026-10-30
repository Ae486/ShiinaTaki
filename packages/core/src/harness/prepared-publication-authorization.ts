/**
 * INPUT: a trusted Core adapter's explicit Class A classification, accepted scope and live authority check
 * OUTPUT: process-owned immutable authorization handle and exact scope/currentness validation
 * POS: core/harness — retained authority only; no business classifier, execution ledger or public grant endpoint
 */
import { PreparedPublicationAuthorizationScopeSchema,
  type PreparedPublicationAuthorizationScope, type PreparedPublicationValidity } from "@taki/shared";
import { matchesPrimaryRequestWitness, type PrimaryRequestWitness } from "./primary-request-witness.ts";

const authorizationIdentity = Symbol("prepared-publication-authorization");
export interface PreparedPublicationAuthorization {
  readonly [authorizationIdentity]: true;
}
type AcceptanceScope = Omit<PreparedPublicationAuthorizationScope, "deliveryClass">;
interface RegisteredAuthorization {
  readonly scope: Readonly<PreparedPublicationAuthorizationScope>;
  readonly isCurrent: () => boolean;
}
// Weak identity prevents JSON-shaped handles from becoming authority. It stores no Run, output or replay state.
const authorizations = new WeakMap<object, RegisteredAuthorization>();

/** Trusted Core registration only. The caller owns the real acceptance/classification; JSON scope proves neither. */
export function createPreparedPublicationAuthorization(input: {
  scope: PreparedPublicationAuthorizationScope; isCurrent(): boolean; originalRequestWitness?: PrimaryRequestWitness;
}): PreparedPublicationAuthorization {
  const scope = Object.freeze(PreparedPublicationAuthorizationScopeSchema.parse(input.scope));
  Object.freeze(scope.validity);
  if (scope.validity.kind === "until_cancelled" && !matchesPrimaryRequestWitness(input.originalRequestWitness, scope)) {
    throw new Error("PREPARED_ORIGINAL_REQUEST_REQUIRED");
  }
  const authorization = Object.freeze({ [authorizationIdentity]: true as const });
  authorizations.set(authorization, { scope, isCurrent: input.isCurrent.bind(input) });
  if (!readPreparedPublicationAuthorization(authorization, scope)) throw new Error("PREPARED_AUTHORIZATION_UNAVAILABLE");
  return authorization;
}

export function readPreparedPublicationAuthorization(authorization: unknown,
  expected: AcceptanceScope): Readonly<PreparedPublicationAuthorizationScope> | undefined {
  if (typeof authorization !== "object" || authorization === null) return undefined;
  const registered = authorizations.get(authorization);
  if (!registered) return undefined;
  const scope = registered.scope;
  if (scope.sourceRef !== expected.sourceRef || scope.acceptanceRef !== expected.acceptanceRef
    || scope.characterId !== expected.characterId || !samePublicationValidity(scope.validity, expected.validity)
    || (scope.validity.kind === "expires_at" && Date.now() >= Date.parse(scope.validity.expiresAt))) return undefined;
  try { return registered.isCurrent() === true ? scope : undefined; }
  catch { return undefined; }
}

export function samePublicationValidity(left: PreparedPublicationValidity, right: PreparedPublicationValidity): boolean {
  return left.kind === right.kind && (left.kind === "until_cancelled"
    || (right.kind === "expires_at" && left.expiresAt === right.expiresAt));
}
