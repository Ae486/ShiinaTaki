/**
 * INPUT:  the live PetScene (its switchCostume) + the operator WsClient (from the connection store); ACTIVE_CHARACTER_ID.
 * OUTPUT: useCostumeSwitch(scene) -> { costumes (renderable first), availability, missingPacksUnion, current,
 *         switchingId (the costume mid-switch, or null), error, switchTo, cancelSwitch, refresh } for the operator panel.
 * POS:    ui/features/character-import — the ONLY costume touchpoint between the panel UI and ws-client/scene
 *         (hook-guidelines). A switch fetches the costume's external-ref resolution, reloads it in the renderer, then
 *         commits at renderer attachment, then synchronizes avatar.report separately. Components never call ws-client.
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CharacterCostumesResult, CostumeAvailability } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { loadLastCostume, saveLastCostume } from "@/lib/last-costume.js";
import {
  startCostumeSwitchAttempt,
  type CostumeAttemptHandle,
  type CostumeCommit,
} from "@/lib/costume-switch-attempt.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export interface CostumeSwitch {
  costumes: string[]; // renderable first (stable within each half) — the panel renders them in this order
  availability: Record<string, CostumeAvailability>;
  missingPacksUnion: string[]; // owners whose packs would unlock/complete costumes — feeds the panel's notice row
  current: string | null;
  switchingId: string | null; // the costume currently mid-switch (drives that ONE row's spinner + Cancel), else null
  error: string | null;
  switchTo: (costume: string) => Promise<void>;
  cancelSwitch: () => void; // abort the in-flight switch and release the panel immediately (does not wait out the timeout)
  refresh: () => Promise<void>;
}

interface CostumesState {
  costumes: string[];
  files: Record<string, string>;
  availability: Record<string, CostumeAvailability>;
  current: string | null;
}

const EMPTY: CostumesState = { costumes: [], files: {}, availability: {}, current: null };

function toState(result: CharacterCostumesResult, current: string | null): CostumesState {
  const availability = result.availability ?? {};
  const rank = (id: string): number => (availability[id]?.renderable === false ? 1 : 0);
  // The panel's initial highlight mirrors what the pet actually wears: the remembered last-worn costume (the initial
  // promotion loads it) rather than the marker default (B7/B19).
  const remembered = loadLastCostume(ACTIVE_CHARACTER_ID, localStorage);
  const fallback = remembered !== null && result.costumes.includes(remembered) ? remembered : result.defaultCostume;
  return {
    costumes: [...result.costumes].sort((a, b) => rank(a) - rank(b)),
    files: result.settingsFilesByCostume,
    availability,
    current: current ?? fallback,
  };
}

function packsUnion(availability: Record<string, CostumeAvailability>): string[] {
  return [...new Set(Object.values(availability).flatMap((entry) => entry.missingPacks))].sort();
}

export interface GuardedAttempt {
  id: string | null;
  gen: number;
  attempt: CostumeAttemptHandle | null;
  client: WsClient | null;
  scene: PetScene | null;
}

export type SwitchGuard = { current: GuardedAttempt };

function saveCommittedCostume(costumeId: string): void {
  try {
    saveLastCostume(ACTIVE_CHARACTER_ID, costumeId, localStorage);
  } catch (cause) {
    // Renderer attachment is irreversible in the current scene API. A storage failure is diagnostic, never permission
    // to tell Home the visible switch failed or to keep the in-memory identity on the previous costume.
    console.warn(`[pet] committed costume ${costumeId} could not update last-costume persistence`, cause);
  }
}

export interface SwitchSink {
  setSwitchingId: (id: string | null) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
}

interface CommitInput {
  commit: CostumeCommit;
  guard: SwitchGuard;
  sink: SwitchSink;
  gen: number;
}

function commitSwitch(input: CommitInput): void {
  if (input.guard.current.gen !== input.gen) return;
  saveCommittedCostume(input.commit.costumeId);
  input.sink.onSuccess();
  input.guard.current = { id: null, gen: input.gen, attempt: null, client: null, scene: null };
  input.sink.setSwitchingId(null);
}

// One guarded switch attempt. A generation stamps this run so a Cancel (which bumps the generation) turns its late
// catch/finally into a no-op — a wedged switch's eventual timeout is swallowed, no stale error toast contradicts the
// operator's Cancel, and a cancel-then-reswitch never clobbers the new run's spinner. Extracted so the hook stays in caps.
export async function runGuardedSwitch(
  req: { client: WsClient; scene: PetScene; costume: string; settingsFile: string },
  guard: SwitchGuard,
  sink: SwitchSink,
): Promise<void> {
  const gen = guard.current.gen + 1;
  guard.current = { id: req.costume, gen, attempt: null, client: req.client, scene: req.scene };
  sink.setSwitchingId(req.costume);
  sink.setError(null);
  const attempt = startCostumeSwitchAttempt({
    ...req,
    onCommit: (commit) => commitSwitch({ commit, guard, sink, gen }),
  });
  if (guard.current.gen === gen) guard.current.attempt = attempt;
  try {
    await attempt.result;
  } catch (cause) {
    if (guard.current.gen === gen) sink.setError(`${req.costume}: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    if (guard.current.gen === gen && guard.current.id !== null) {
      guard.current = { id: null, gen, attempt: null, client: null, scene: null };
      sink.setSwitchingId(null);
    }
  }
}

function useCostumeData(client: WsClient | null, connected: boolean): {
  state: CostumesState;
  setState: Dispatch<SetStateAction<CostumesState>>;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<CostumesState>(EMPTY);
  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setState((prev) => toState(result, prev.current));
    } catch {
      // character.costumes currently cannot distinguish the normal unimported dev fallback from a transient read
      // failure. Keep last-good metadata and stay silent; reconnect will retry with the next authenticated client.
      return;
    }
  }, [client]);
  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);
  return { state, setState, refresh };
}

function useSupersessionCleanup(input: {
  guard: SwitchGuard;
  client: WsClient | null;
  scene: PetScene | null;
  setError: (error: string | null) => void;
  setSwitchingId: (id: string | null) => void;
}): void {
  useEffect(
    () => () => {
      const active = input.guard.current;
      if (active.id === null || active.client !== input.client || active.scene !== input.scene) return;
      active.attempt?.cancel("superseded");
      input.guard.current = { id: null, gen: active.gen + 1, attempt: null, client: null, scene: null };
      input.setError(`${active.id}: costume attempt superseded by a connection or scene replacement`);
      input.setSwitchingId(null);
    },
    [input.client, input.guard, input.scene, input.setError, input.setSwitchingId],
  );
}

export function useCostumeSwitch(scene: PetScene | null): CostumeSwitch {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const { state, setState, refresh } = useCostumeData(client, connected);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ref mirror of the in-flight switch (id for the re-entrancy guard + a generation so a cancelled switch's late
  // catch/finally is a no-op). switchTo's useCallback deps intentionally omit switching state, so it reads the ref.
  const inFlight = useRef<GuardedAttempt>({ id: null, gen: 0, attempt: null, client: null, scene: null });
  useSupersessionCleanup({ guard: inFlight, client, scene, setError, setSwitchingId });

  const switchTo = useCallback(
    async (costume: string) => {
      const settingsFile = state.files[costume];
      // The panel disables unrenderable rows; this guard makes the no-op authoritative rather than cosmetic.
      if (!client || !scene || !settingsFile || state.availability[costume]?.renderable === false) return;
      if (inFlight.current.id !== null) return; // one switch at a time (ref, not the stale-closure state)
      await runGuardedSwitch({ client, scene, costume, settingsFile }, inFlight, {
        setSwitchingId,
        setError,
        onSuccess: () => setState((prev) => ({ ...prev, current: costume })),
      });
    },
    [client, scene, state.files, state.availability],
  );

  // Operator Cancel releases the panel now. The attempt token blocks any not-yet-started stage and invalidates a live
  // renderer ticket; the bumped generation suppresses its eventual catch/finally after a cancel-then-reswitch.
  const cancelSwitch = useCallback(() => {
    if (inFlight.current.id === null) return;
    inFlight.current.attempt?.cancel("cancelled");
    inFlight.current = {
      id: null,
      gen: inFlight.current.gen + 1,
      attempt: null,
      client: null,
      scene: null,
    };
    setSwitchingId(null);
  }, []);

  return {
    costumes: state.costumes,
    availability: state.availability,
    missingPacksUnion: packsUnion(state.availability),
    current: state.current,
    switchingId,
    error,
    switchTo,
    cancelSwitch,
    refresh,
  };
}
