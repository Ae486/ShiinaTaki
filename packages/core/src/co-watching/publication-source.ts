/**
 * INPUT: an explicitly registered trusted media producer's current accepted Co-Watching views
 * OUTPUT: M51 Class A classification feeding the generic authorized prepared-publication source
 * POS: core/co-watching — classification adapter used by the explicit runtime; owns no UI, queue or startup wiring
 */
import { CoWatchingPublicationSourceSchema } from "@taki/shared";
import { createPreparedPublicationSource, type PreparedPublicationProducer } from "../delivery/prepared-publication-source.ts";
import { createPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";

/** The producer must own real acceptance. Parsing its data cannot create consent, classify an invitation or grant OS access. */
export function createCoWatchingPublicationSource(producer: PreparedPublicationProducer) {
  const accepted = readAccepted(producer);
  const authorization = createPreparedPublicationAuthorization({
    scope: { sourceRef: accepted.sourceRef, acceptanceRef: accepted.acceptanceRef,
      characterId: accepted.characterId, validity: accepted.validity, deliveryClass: "class_a" },
    isCurrent: () => {
      const current = readAccepted(producer);
      return producer.isCurrent() === true && current.sourceRef === accepted.sourceRef
        && current.acceptanceRef === accepted.acceptanceRef && current.characterId === accepted.characterId
        && current.validity.expiresAt === accepted.validity.expiresAt;
    },
  });
  return createPreparedPublicationSource({ readAccepted: () => readAccepted(producer),
    resolve: (input) => producer.resolve(input), isCurrent: () => producer.isCurrent(),
    gate: (candidate) => producer.gate(candidate) }, authorization);
}

function readAccepted(producer: PreparedPublicationProducer) {
  const accepted = CoWatchingPublicationSourceSchema.parse(producer.readAccepted());
  return { sourceRef: accepted.sourceRef, acceptanceRef: accepted.acceptanceRef,
    characterId: accepted.characterId, revision: accepted.revision,
    validity: { kind: "expires_at" as const, expiresAt: accepted.expiresAt } };
}
