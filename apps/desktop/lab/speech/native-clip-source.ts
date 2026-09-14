/**
 * INPUT:  an explicitly selected local file or operator-requested provider synthesis.
 * OUTPUT: retained clip bytes/metadata for native replay, abortable synthesis and rejection of stale input completions.
 * POS:    experimental / lab — not in production path; no decoding, audio output, persistent secrets or external auto-start.
 */

import type { SpeechClip, SpeechProvider, SpeechRequest } from "./speech-provider.ts";

export interface NativeClipSnapshot {
  status: "empty" | "loading-file" | "synthesizing" | "ready" | "error";
  error: string | null;
  clip: { name: string; bytes: number; mimeType: string; providerId: SpeechClip["providerId"]; synthesisMs: number | null } | null;
}

export interface NativeClipSource {
  loadFile(file: Pick<File, "name" | "type" | "arrayBuffer">): Promise<boolean>;
  synthesize(provider: SpeechProvider, request: SpeechRequest): Promise<boolean>;
  clip(): SpeechClip | null;
  snapshot(): NativeClipSnapshot;
  cancel(): void;
  dispose(): void;
}

export function createNativeClipSource(): NativeClipSource {
  return new ClipSource();
}

class ClipSource implements NativeClipSource {
  private current: SpeechClip | null = null;
  private meta: NativeClipSnapshot["clip"] = null;
  private status: NativeClipSnapshot["status"] = "empty";
  private error: string | null = null;
  private revision = 0;
  private abort: AbortController | null = null;
  private disposed = false;

  async loadFile(file: Pick<File, "name" | "type" | "arrayBuffer">): Promise<boolean> {
    if (this.disposed) return false;
    const revision = this.begin("loading-file");
    try {
      const bytes = await file.arrayBuffer();
      if (!this.active(revision)) return false;
      if (bytes.byteLength === 0) return this.fail("The selected file is empty.");
      const mimeType = file.type || (file.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav");
      this.accept({ bytes, mimeType, providerId: "local-file", elapsedMs: 0 }, file.name);
      return true;
    } catch {
      return this.active(revision) ? this.fail("The selected audio file could not be read.") : false;
    }
  }

  async synthesize(provider: SpeechProvider, request: SpeechRequest): Promise<boolean> {
    if (this.disposed) return false;
    const revision = this.begin("synthesizing");
    if (!request.text.trim()) return this.fail("Speech text is empty.");
    const abort = new AbortController();
    this.abort = abort;
    try {
      const clip = await provider.synthesize(request, abort.signal);
      if (!this.active(revision)) return false;
      if (clip.bytes.byteLength === 0) return this.fail("The provider returned empty audio.");
      this.accept(clip, `${provider.id} ${request.format}`);
      return true;
    } catch (error) {
      // Provider adapters sanitize errors at the HTTP boundary. They are shown in the panel, never copied to findings.
      return this.active(revision) ? this.fail(error instanceof Error ? error.message : "Speech synthesis failed.") : false;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  clip(): SpeechClip | null { return this.current; }

  snapshot(): NativeClipSnapshot {
    return { status: this.status, error: this.error, clip: this.meta === null ? null : { ...this.meta } };
  }

  cancel(): void {
    this.revision += 1;
    this.abort?.abort();
    this.abort = null;
    this.status = this.current === null ? "empty" : "ready";
    this.error = null;
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.current = null;
    this.meta = null;
    this.status = "empty";
  }

  private begin(status: NativeClipSnapshot["status"]): number {
    this.cancel();
    this.status = status;
    return this.revision;
  }

  private active(revision: number): boolean { return !this.disposed && this.revision === revision; }

  private accept(clip: SpeechClip, name: string): void {
    this.current = clip;
    this.meta = { name, bytes: clip.bytes.byteLength, mimeType: clip.mimeType, providerId: clip.providerId,
      synthesisMs: clip.providerId === "local-file" ? null : clip.elapsedMs };
    this.status = "ready";
    this.error = null;
  }

  private fail(message: string): false {
    this.status = "error";
    this.error = message;
    return false;
  }
}
