/**
 * INPUT:  chosen archives and the current operator client, plus presentation outcome callbacks.
 * OUTPUT: serialized import attempts with cleared prior results, retained warnings/errors and guarded settlement.
 * POS:    Character import action owner; Core validates archive contents and owns imported character state.
 */
import type { CharacterImportResult, CharacterSource } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";

type ImportClient = Pick<WsClient, "importCharacter">;
export interface CharacterImportState {
  isImporting: boolean;
  result: CharacterImportResult | null;
  error: string | null;
}
interface ImportSink {
  changed(state: CharacterImportState): void;
  started(): void;
  succeeded(result: CharacterImportResult, eventKey: object): void;
  failed(eventKey: object): void;
}

export function initialCharacterImport(): CharacterImportState {
  return { isImporting: false, result: null, error: null };
}

export function createCharacterImportController(sink: ImportSink) {
  return new CharacterImports(sink);
}

class CharacterImports {
  private state = initialCharacterImport();
  private client: ImportClient | null = null;
  private epoch = 0;
  private submitted = false;
  private readonly sink: ImportSink;
  constructor(sink: ImportSink) { this.sink = sink; }

  replace(client: ImportClient | null): void {
    if (this.client === client) return;
    this.client = client;
    this.epoch += 1;
    // A replacement connection cannot establish the old write's outcome. Retain its diagnostic until
    // another deliberate attempt clears it; the retired completion still has no publication authority.
    const error = this.state.isImporting && this.submitted ? "连接已变化，导入结果尚未确认；请刷新服装列表核对。" : this.state.error;
    this.set({ ...initialCharacterImport(), error });
  }

  dispose(): void { this.client = null; this.epoch += 1; }

  importFile = async (file: File): Promise<void> => {
    if (this.state.isImporting) return;
    const eventKey = {};
    this.sink.started();
    this.set(initialCharacterImport());
    const client = this.client;
    const sourceKind = sourceKindFor(file.name);
    if (!client) { this.fail("尚未连接到 Agent Core", eventKey); return; }
    if (!sourceKind) { this.fail(`「${file.name}」不是 .zip 或 .zst 归档`, eventKey); return; }
    const epoch = this.epoch;
    this.submitted = false;
    this.set({ ...initialCharacterImport(), isImporting: true });
    try {
      const archiveBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
      if (!this.current(client, epoch)) return;
      this.submitted = true;
      const result = await client.importCharacter({ sourceKind, archiveBase64, fileName: file.name });
      if (!this.current(client, epoch)) return;
      this.set({ isImporting: false, result, error: null });
      this.sink.succeeded(result, eventKey);
    } catch (cause) {
      if (this.current(client, epoch)) this.fail(cause instanceof Error ? cause.message : String(cause), eventKey);
    }
  };

  private current(client: ImportClient, epoch: number): boolean {
    return this.client === client && this.epoch === epoch;
  }
  private fail(error: string, eventKey: object): void {
    this.set({ isImporting: false, result: null, error });
    this.sink.failed(eventKey);
  }
  private set(state: CharacterImportState): void { this.state = state; this.sink.changed(state); }
}

function sourceKindFor(fileName: string): CharacterSource | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zst")) return "zst";
  if (lower.endsWith(".zip")) return "zip";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Bound each argument list: imported archives can exceed the engine's apply/spread limit.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
