/**
 * INPUT:  a capability.respond Ok payload (opaque Value on the wire) parsed by the core tool that owns it
 * OUTPUT: one output schema per capability (Screenshot/ProcessList/ClipboardRead/ClipboardWrite/ShellOpen/Exec) + types
 * POS:    shared/protocol — the per-capability output contracts (Option A); each mirrored by that capability's Rust serde struct (invariant 3)
 */
import { z } from "zod";

// The screenshot capability output — moved out of the channel core so `output` on the wire stays opaque (Option A).
// dataBase64 is content — it never enters a log.
export const ScreenshotOutputSchema = z.strictObject({
  mediaType: z.literal("image/png"),
  dataBase64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ScreenshotOutput = z.infer<typeof ScreenshotOutputSchema>;

// One running process. memoryBytes is a u64 (may exceed 2^32) so it stays a plain number, not an int32; parentPid is
// absent for a root/orphaned process. cmd/argv is deliberately EXCLUDED in v1 (leaks URLs/tokens — ruling 5).
export const ProcessInfoSchema = z.strictObject({
  pid: z.number().int().nonnegative(),
  name: z.string(),
  parentPid: z.number().int().nonnegative().nullable(),
  memoryBytes: z.number().nonnegative(),
  startTime: z.number().int().nonnegative(),
});
export type ProcessInfo = z.infer<typeof ProcessInfoSchema>;

export const ProcessListOutputSchema = z.strictObject({
  processes: z.array(ProcessInfoSchema),
  count: z.number().int().nonnegative(),
});
export type ProcessListOutput = z.infer<typeof ProcessListOutputSchema>;

// Clipboard read carries the text (content — never logged); an empty clipboard is a clean "" success (ruling 6).
export const ClipboardReadOutputSchema = z.strictObject({
  text: z.string(),
});
export type ClipboardReadOutput = z.infer<typeof ClipboardReadOutputSchema>;

// Ack shapes: a bare success confirmation carrying no content back to the model.
export const ClipboardWriteOutputSchema = z.strictObject({
  ok: z.literal(true),
});
export type ClipboardWriteOutput = z.infer<typeof ClipboardWriteOutputSchema>;

// shell-open echoes the launched target so the model can confirm what was opened (the launch itself is fire-and-forget;
// the target stays out of the audit line and every log — dialog + model only).
export const ShellOpenOutputSchema = z.strictObject({
  ok: z.literal(true),
  opened: z.string().min(1),
});
export type ShellOpenOutput = z.infer<typeof ShellOpenOutputSchema>;

// exec (#12) returns the full run outcome (Option A opaque payload). A nonzero exit / timeout / truncation is a
// SUCCESSFUL capability execution, not a wire error — the model reads exitCode/stderr/timedOut to reason and retry.
// exitCode is null when the child was killed before exit (timeout or output-cap). stdout/stderr are content — never logged.
export const ExecOutputSchema = z.strictObject({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
export type ExecOutput = z.infer<typeof ExecOutputSchema>;
