/**
 * INPUT:  a devices.json path under the app data root (TAKI_DATA_DIR)
 * OUTPUT: createPairedDeviceStore(path) -> { find, save }; atomic JSON persistence of paired devices
 * POS:    core/devices — SANCTIONED node:fs site (core-owned security state, not agent-reachable; invariant 1, prd §4)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { RoleSchema } from "@taki/shared";

const PairedDeviceSchema = z.object({
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  role: RoleSchema,
  tokenHash: z.string().min(1),
  pairedAt: z.string().min(1),
});
export type PairedDevice = z.infer<typeof PairedDeviceSchema>;

const DeviceStoreFileSchema = z.object({ devices: z.array(PairedDeviceSchema) });
type DeviceStoreFile = z.infer<typeof DeviceStoreFileSchema>;

export interface PairedDeviceStore {
  find(deviceId: string): PairedDevice | undefined;
  /** Upserts by deviceId, then persists the whole store atomically (temp file + rename). */
  save(device: PairedDevice): void;
}

export function createPairedDeviceStore(filePath: string): PairedDeviceStore {
  let devices = loadDevices(filePath);
  return {
    find(deviceId) {
      return devices.find((device) => device.deviceId === deviceId);
    },
    save(device) {
      const next = devices.filter((existing) => existing.deviceId !== device.deviceId);
      next.push(device);
      persistDevices(filePath, next);
      devices = next;
    },
  };
}

// A missing file is an empty store (first boot); a present-but-unreadable file is fatal-fast
// with a readable message — a corrupted security store must never degrade into "no devices".
function loadDevices(filePath: string): PairedDevice[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`device store ${filePath} is not valid JSON`, { cause: error });
  }
  const result = DeviceStoreFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`device store ${filePath} is malformed: ${result.error.message}`);
  return result.data.devices;
}

function persistDevices(filePath: string, devices: PairedDevice[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ devices } satisfies DeviceStoreFile, null, 2));
  renameSync(tempPath, filePath);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
