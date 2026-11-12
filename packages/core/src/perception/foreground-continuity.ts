/**
 * INPUT: sanctioned foreground samples and their accepted source/consent epoch
 * OUTPUT: one bounded application occurrence with real consecutive dwell and nullable idle
 * POS: core/perception — derived evidence only; no sensor, title payload or policy dispatch
 */
import { randomUUID } from "node:crypto";
import { InitiativeForegroundFactSchema, type InitiativeForegroundFact } from "@taki/shared";
import type { ForegroundEvidenceInput } from "./perception-evidence.ts";

const IDLE_THRESHOLD_SECONDS = 180;
function idleState(idleSeconds: number | null): "unknown" | "active" | "idle" {
  return idleSeconds === null ? "unknown" : idleSeconds >= IDLE_THRESHOLD_SECONDS ? "idle" : "active";
}

export function nextForegroundFact(input: {
  previous: InitiativeForegroundFact | undefined;
  accepted: ForegroundEvidenceInput;
  epoch: number;
  freshnessMs: number;
}): InitiativeForegroundFact | undefined {
  const { previous, accepted, epoch, freshnessMs } = input;
  const source = accepted.provenance;
  if (!source || !accepted.sample.available || !accepted.sample.processName) return;
  const application = accepted.sample.processName;
  const continuous = previous !== undefined && previous.observationEpoch === epoch
    && previous.hostId === source.hostId && previous.connectionGeneration === source.connectionGeneration
    && previous.catalogGeneration === source.catalogGeneration && previous.application === application
    && idleState(previous.idleSeconds) === idleState(accepted.sample.idleSeconds)
    && accepted.observedAt > previous.observedAt && accepted.observedAt - previous.observedAt < freshnessMs;
  const fact = InitiativeForegroundFactSchema.safeParse({
    occurrenceKey: continuous ? previous.occurrenceKey : randomUUID(),
    application, observedAt: accepted.observedAt,
    startedAt: continuous ? previous.startedAt : accepted.observedAt,
    meaningful: continuous, idleSeconds: accepted.sample.idleSeconds, observationEpoch: epoch,
    hostId: source.hostId, connectionGeneration: source.connectionGeneration, catalogGeneration: source.catalogGeneration,
  });
  return fact.success ? fact.data : undefined;
}
