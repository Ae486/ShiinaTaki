/**
 * INPUT:  a browser-storage backend (localStorage by default); the operator identity record it holds.
 * OUTPUT: loadOrCreateIdentity(storage) -> { deviceId, token? }; saveToken(token, storage) persists the reconnect token.
 * POS:    ui/lib — the Pet UI's own operator device identity (mirrors the CLI's device-identity.ts). A local client
 *         credential, NOT agent-domain state (invariant 4); persisted in the webview's localStorage, not the Core DB.
 */

const STORAGE_KEY = "taki.operator-identity";

// Storage-shaped seam so this is unit-testable in node (no jsdom): tests inject a fake; the app uses localStorage.
export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OperatorIdentity {
  deviceId: string;
  token?: string;
}

/** First run mints a stable UUID deviceId and writes it; later runs read it back unchanged (stable operator identity). */
export function loadOrCreateIdentity(storage: IdentityStorage): OperatorIdentity {
  const existing = readIdentity(storage);
  if (existing) return existing;
  const identity: OperatorIdentity = { deviceId: crypto.randomUUID() };
  writeIdentity(storage, identity);
  return identity;
}

/** Persists the reconnect token issued after a successful pairing so later launches skip pairing. */
export function saveToken(token: string, storage: IdentityStorage): void {
  const current = readIdentity(storage) ?? { deviceId: crypto.randomUUID() };
  writeIdentity(storage, { ...current, token });
}

// A corrupt identity record is not fatal here (unlike the Core's trust root): drop it and mint a fresh device — the
// worst case is one extra pairing, never a stuck client.
function readIdentity(storage: IdentityStorage): OperatorIdentity | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    if (!("deviceId" in value) || typeof value.deviceId !== "string" || value.deviceId.length === 0) return null;
    const token = "token" in value && typeof value.token === "string" ? value.token : undefined;
    return token === undefined ? { deviceId: value.deviceId } : { deviceId: value.deviceId, token };
  } catch {
    return null;
  }
}

function writeIdentity(storage: IdentityStorage, identity: OperatorIdentity): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(identity));
}
