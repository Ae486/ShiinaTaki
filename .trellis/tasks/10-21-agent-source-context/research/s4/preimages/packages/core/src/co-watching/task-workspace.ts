/**
 * INPUT: verified native result, exact accepted session and one completed proposal file
 * OUTPUT: full/compact source files and validated revision-bound candidate data
 * POS: core/co-watching — task contents in Workspace; source/consent and delivered state remain Core-owned
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CoWatchingPlanSchema, type CoWatchingPlan } from "@taki/shared";
import type { CoWatchingBinding } from "./runtime-types.ts";

export function coWatchingPaths(session: CoWatchingBinding) {
  return { input: `co-watching-inputs/${session.id}`, output: `co-watching/${session.id}` };
}

export async function writeCoWatchingInput(root: string, session: CoWatchingBinding, complete: unknown): Promise<void> {
  if (!session.analysis) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  const paths = coWatchingPaths(session);
  await mkdir(join(root, paths.input), { recursive: true });
  await mkdir(join(root, paths.output), { recursive: true });
  await writeFile(join(root, paths.input, "native-result.json"), JSON.stringify(complete), "utf8");
  await writeFile(join(root, paths.input, "analysis.json"), JSON.stringify({
    identity: session.analysis.native, media: session.analysis.media, analysis: session.native?.analysis,
    boundedMomentIds: session.native?.analysis.moments.filter((moment) => moment.end_seconds !== null).map((moment) => moment.moment_id) ?? [],
    completeResultPath: `${paths.input}/native-result.json`,
  }), "utf8");
}

export async function readCoWatchingPlan(root: string, session: CoWatchingBinding, revision: string): Promise<CoWatchingPlan> {
  const path = join(root, coWatchingPaths(session).output, `${revision}.json`);
  const plan = await readProposal(path);
  if (plan.revision !== revision || !session.native) throw new Error("CO_WATCHING_PLAN_INVALID");
  const moments = new Set(session.native.analysis.moments.filter((moment) => moment.end_seconds !== null).map((moment) => moment.moment_id));
  for (const item of plan.candidates) {
    if (!moments.has(item.momentId)) throw new Error("CO_WATCHING_PLAN_INVALID");
    const sent = session.committed.get(item.candidateRef);
    if (sent && (sent.text !== item.text || sent.momentId !== item.momentId)) throw new Error("CO_WATCHING_PLAN_INVALID");
    if (!sent && [...session.committed.values()].some((entry) => entry.momentId === item.momentId)) throw new Error("CO_WATCHING_PLAN_INVALID");
  }
  return plan;
}

async function readProposal(path: string): Promise<CoWatchingPlan> {
  try {
    if ((await stat(path)).size > 256 * 1024) throw new Error("Proposal too large");
    return CoWatchingPlanSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    // A missing, partial or malformed completed proposal is a plan failure, never model-publication authority.
    throw new Error("CO_WATCHING_PLAN_INVALID");
  }
}

export async function writeCoWatchingCurrent(root: string, session: CoWatchingBinding): Promise<void> {
  await writeFile(join(root, coWatchingPaths(session).input, "current-plan.json"), JSON.stringify({
    plan: session.plan, closedCandidateRefs: [...session.committed.keys()], confirmedSentCandidateRefs: [...session.sent.keys()],
    expiredMomentIds: session.native?.analysis.moments.filter((moment) =>
      moment.end_seconds !== null && session.furthestPositionSeconds !== null
      && moment.end_seconds < session.furthestPositionSeconds).map((moment) => moment.moment_id) ?? [],
  }), "utf8");
}
