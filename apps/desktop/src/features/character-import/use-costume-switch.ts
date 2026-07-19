/**
 * INPUT:  the live PetScene (its switchCostume) + the operator WsClient (from the connection store); ACTIVE_CHARACTER_ID.
 * OUTPUT: useCostumeSwitch(scene) -> { costumes (renderable first), availability, missingPacksUnion, current,
 *         switchingId (the costume mid-switch, or null), error, switchTo, cancelSwitch, refresh } for the operator panel.
 * POS:    ui/features/character-import — the ONLY costume touchpoint between the panel UI and ws-client/scene
 *         (hook-guidelines). A switch fetches the costume's external-ref resolution, reloads it in the renderer, then
 *         re-reports vocab via the EXISTING avatar.report (arch §6b). Components never call ws-client directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterCostumesResult, CostumeAvailability } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { loadLastCostume, saveLastCostume } from "@/lib/last-costume.js";
import { resolveSwitchReport } from "@/lib/resolve-switch-report.js";
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

// A wedged model load (resources that never finish — B-test: roaming C3 hangs) must not freeze the panel forever:
// reject after this long so the switch releases and the error names the costume. On timeout resolveSwitchReport aborts
// the switch, so the late model self-discards (1f Fix 1) rather than attaching a costume the stores never advanced to.
const SWITCH_TIMEOUT_MS = 30_000;

type SwitchGuard = { current: { id: string | null; gen: number } };

// One guarded switch attempt. A generation stamps this run so a Cancel (which bumps the generation) turns its late
// catch/finally into a no-op — a wedged switch's eventual timeout is swallowed, no stale error toast contradicts the
// operator's Cancel, and a cancel-then-reswitch never clobbers the new run's spinner. Extracted so the hook stays in caps.
async function runGuardedSwitch(
  req: { client: WsClient; scene: PetScene; costume: string; settingsFile: string },
  guard: SwitchGuard,
  sink: { setSwitchingId: (id: string | null) => void; setError: (error: string | null) => void; onSuccess: () => void },
): Promise<void> {
  const gen = guard.current.gen + 1;
  guard.current = { id: req.costume, gen };
  sink.setSwitchingId(req.costume);
  sink.setError(null);
  try {
    await resolveSwitchReport({ ...req, timeoutMs: SWITCH_TIMEOUT_MS });
    saveLastCostume(ACTIVE_CHARACTER_ID, req.costume, localStorage); // restarts re-wear this costume (B7/B19)
    sink.onSuccess();
  } catch (cause) {
    if (guard.current.gen === gen) sink.setError(`${req.costume}: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    if (guard.current.gen === gen) {
      guard.current = { id: null, gen };
      sink.setSwitchingId(null);
    }
  }
}

export function useCostumeSwitch(scene: PetScene | null): CostumeSwitch {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const [state, setState] = useState<CostumesState>(EMPTY);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ref mirror of the in-flight switch (id for the re-entrancy guard + a generation so a cancelled switch's late
  // catch/finally is a no-op). switchTo's useCallback deps intentionally omit switching state, so it reads the ref.
  const inFlight = useRef<{ id: string | null; gen: number }>({ id: null, gen: 0 });

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setState((prev) => toState(result, prev.current));
    } catch {
      setState(EMPTY); // no imported character yet (dev route) — empty switcher
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

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

  // Operator Cancel: abort the in-flight switch (its late model self-discards via the switch ticket, 1f Fix 1) and
  // release the panel NOW — the pending resolveSwitchReport settles later (up to the timeout) but the bumped generation
  // makes its catch/finally a no-op, so no stale error toast contradicts the cancel.
  const cancelSwitch = useCallback(() => {
    if (inFlight.current.id === null) return;
    scene?.abortSwitch();
    inFlight.current = { id: null, gen: inFlight.current.gen + 1 };
    setSwitchingId(null);
  }, [scene]);

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
