/**
 * INPUT:  raw markdown read from a human-editable prompt file (persona card, memory block)
 * OUTPUT: stripNoteBlock(markdown) -> the same markdown with its leading `>` editorial note removed
 * POS:    core/memory — the shared `>` editor-note convention (D22); every human-editable file that reaches a prompt
 *         strips through here so a note written for the human never reaches the model
 */

/**
 * Removes only the FIRST contiguous run of markdown blockquote (`>`) lines plus the blank separator it leaves;
 * content below (and the title above) is untouched, and any accidental triple blank is collapsed.
 */
export function stripNoteBlock(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const isQuote = (line: string | undefined): boolean => line !== undefined && line.trimStart().startsWith(">");
  const start = lines.findIndex((line) => isQuote(line));
  if (start === -1) return markdown.trim();
  let end = start;
  while (isQuote(lines[end])) end += 1;
  if (lines[end]?.trim() === "") end += 1; // consume the blank line the note block leaves behind
  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
