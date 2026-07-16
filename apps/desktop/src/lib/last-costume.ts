/**
 * INPUT:  a characterId (+ the costume to remember) and an injected Storage (the window's localStorage; a fake in tests).
 * OUTPUT: loadLastCostume / saveLastCostume — the operator's last-worn costume per character, surviving restarts.
 * POS:    ui/lib — pet-window-local presentation state (device-identity's localStorage pattern). Real config
 *         persistence (Core-side, cross-device) is M5 #24; this only stops restarts snapping back to defaultCostume.
 */

const KEY_PREFIX = "taki.last-costume.";

export function loadLastCostume(characterId: string, storage: Storage): string | null {
  const value = storage.getItem(KEY_PREFIX + characterId);
  return value !== null && value.length > 0 ? value : null;
}

export function saveLastCostume(characterId: string, costume: string, storage: Storage): void {
  storage.setItem(KEY_PREFIX + characterId, costume);
}
