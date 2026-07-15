/**
 * INPUT:  a markdown string (an assistant/tool/user text part, possibly still streaming).
 * OUTPUT: <MarkdownView> — GFM-rendered markdown, default-safe (raw HTML escaped, javascript: URLs defanged).
 * POS:    ui/windows/chat — the ONE markdown wrapper (react-markdown@10 + remark-gfm@4, research r2). No rehype-raw /
 *         rehype-sanitize. Tailwind v4 preflight strips list/heading styles, so prose utilities are applied here.
 */

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Scoped descendant utilities stand in for a typography plugin (not installed): headings, lists, code, tables, links.
const PROSE = [
  "text-sm leading-relaxed break-words",
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:font-semibold",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_a]:text-sky-600 [&_a]:underline",
  "[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre]:text-slate-100",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-500",
  "[&_table]:my-2 [&_table]:w-full [&_table]:text-left",
  "[&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1",
  "[&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1",
].join(" ");

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className={PROSE}>
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
