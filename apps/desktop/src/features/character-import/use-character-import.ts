/**
 * INPUT:  a model archive (.zip/.zst) chosen from a hidden <input type="file">; the operator WsClient (connection store).
 * OUTPUT: useCharacterImport() -> { isImporting, result, warnings, error, importFile }; importFile reads bytes → base64
 *         → character.import and surfaces the returned costumes + warnings (#18).
 * POS:    ui/features/character-import — the ONLY import touchpoint between the panel UI and ws-client (hook-guidelines).
 *         Reuses #17's file-pick→base64 seam (web-platform APIs; no Tauri plugin). Components never call ws-client.
 */

import { useCallback, useState } from "react";
import type { CharacterImportResult, CharacterSource } from "@taki/shared";
import { useConnectionStore } from "@/stores/connection-store.js";

// The Core path handles zip + zst (a folder is delivered as a zip of the folder). Anything else is an unsupported pick.
function sourceKindFor(fileName: string): CharacterSource | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zst")) return "zst";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

// Raw archive bytes → base64 (NOT a data URL — the Core decodes base64 to bytes directly). Mirrors #17's FileReader
// seam but reads the whole archive; chunked to keep a large .zst off a single huge apply() call.
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface CharacterImport {
  isImporting: boolean;
  result: CharacterImportResult | null;
  warnings: string[];
  error: string | null;
  importFile: (file: File) => Promise<void>;
}

export function useCharacterImport(): CharacterImport {
  const client = useConnectionStore((s) => s.client);
  const [isImporting, setImporting] = useState(false);
  const [result, setResult] = useState<CharacterImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFile = useCallback(
    async (file: File) => {
      const sourceKind = sourceKindFor(file.name);
      if (!client) return setError("尚未连接到 agent core");
      if (!sourceKind) return setError(`「${file.name}」不是 .zip 或 .zst 归档`);
      setImporting(true);
      setError(null);
      setResult(null);
      try {
        const archiveBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
        setResult(await client.importCharacter({ sourceKind, archiveBase64, fileName: file.name }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setImporting(false);
      }
    },
    [client],
  );

  return { isImporting, result, warnings: result?.warnings ?? [], error, importFile };
}
