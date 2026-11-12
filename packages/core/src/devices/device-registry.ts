/**
 * INPUT:  pairing/verification calls + an injected PairedDeviceStore and clock (now())
 * OUTPUT: createDeviceRegistry({store, now}) -> { beginPairing, completePairing, trustDevice, verifyToken }; PairingError
 * POS:    core/devices — pairing-code lifecycle + token issue/verify (sha256 at rest, timingSafeEqual compare; prd §4)
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Role } from "@taki/shared";
import type { PairedDeviceStore } from "./paired-device-store.ts";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/** Locked into the paired record at pairing; a later role change fails verification (privilege-swap guard). */
export interface DeviceIdentity {
  deviceName: string;
  role: Role;
}

export interface DeviceRegistry {
  /** Starts (or restarts) pairing for a device; returns the 6-digit code to show the operator. */
  beginPairing(deviceId: string): string;
  /** On the right code within TTL/attempts: persists the device, returns the plaintext token ONCE. */
  completePairing(deviceId: string, code: string, identity: DeviceIdentity): string;
  /**
   * Direct-trust a device WITHOUT a pairing code (loopback auto-trust, P3): persists it and returns the
   * plaintext token ONCE, via the SAME issuance path as pairing — no parallel token scheme.
   */
  trustDevice(deviceId: string, identity: DeviceIdentity): string;
  /** Authenticated native enrollment preserves an existing same-role record instead of rotating other windows' tokens. */
  trustLocalDevice(deviceId: string, identity: DeviceIdentity): string | undefined;
  verifyToken(deviceId: string, token: string, role: Role): boolean;
}

export class PairingError extends Error {}

export interface DeviceRegistryDeps {
  store: PairedDeviceStore;
  now?: () => number;
}

interface PendingPairing {
  code: string;
  expiresAt: number;
  attempts: number;
}

export function createDeviceRegistry(deps: DeviceRegistryDeps): DeviceRegistry {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const pending = new Map<string, PendingPairing>();

  // Single token-issuance path shared by pairing and loopback auto-trust: mint a 256-bit token, persist
  // only its sha256, hand back the plaintext ONCE. Never duplicate this — one secret mechanism, one place.
  function issueToken(deviceId: string, identity: DeviceIdentity): string {
    return persistToken({ store, now }, deviceId, identity);
  }

  return {
    beginPairing(deviceId) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      pending.set(deviceId, { code, expiresAt: now() + PAIRING_TTL_MS, attempts: 0 });
      return code;
    },

    completePairing(deviceId, code, identity) {
      const entry = pending.get(deviceId);
      if (!entry || now() >= entry.expiresAt) {
        pending.delete(deviceId);
        throw new PairingError("no active pairing for this device");
      }
      if (entry.code !== code) {
        entry.attempts += 1;
        if (entry.attempts >= MAX_ATTEMPTS) pending.delete(deviceId);
        throw new PairingError("invalid pairing code");
      }
      pending.delete(deviceId);
      return issueToken(deviceId, identity);
    },

    trustDevice(deviceId, identity) {
      return issueToken(deviceId, identity);
    },

    trustLocalDevice(deviceId, identity) {
      const existing = store.find(deviceId);
      if (!existing) return issueToken(deviceId, identity);
      if (existing.role !== identity.role) throw new PairingError("device role does not match its existing identity");
      return undefined;
    },

    verifyToken(deviceId, token, role) {
      const device = store.find(deviceId);
      if (!device || device.role !== role) return false;
      const presented = hashToken(token);
      const stored = Buffer.from(device.tokenHash, "base64");
      return presented.length === stored.length && timingSafeEqual(presented, stored);
    },
  };
}

function persistToken(deps: { store: PairedDeviceStore; now(): number }, deviceId: string, identity: DeviceIdentity): string {
  const token = randomBytes(32).toString("base64url");
  deps.store.save({ deviceId, deviceName: identity.deviceName, role: identity.role,
    tokenHash: hashToken(token).toString("base64"), pairedAt: new Date(deps.now()).toISOString() });
  return token;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
