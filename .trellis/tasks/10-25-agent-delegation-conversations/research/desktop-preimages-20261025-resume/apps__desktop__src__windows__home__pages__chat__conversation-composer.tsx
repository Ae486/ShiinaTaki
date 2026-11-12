/**
 * INPUT: controlled draft, adapter-owned submission policy and optional attachment/action slots
 * OUTPUT: the shared Chat composer geometry and IME-safe keyboard interaction
 * POS: ui/chat — presentation only; main and private controllers retain draft and execution authority
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";

interface ConversationComposerProps {
  editor: { value: string; onChange(value: string): void; placeholder: string; label?: string; maxLength?: number };
  submit: { enabled: boolean; run(): void };
  attachments?: ReactNode;
  leading?: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
}

export function enterSends(key: string, shiftKey: boolean, isComposing: boolean): boolean {
  return !isComposing && key === "Enter" && !shiftKey;
}

export function ConversationComposer({ editor, submit, attachments, leading, actions, footer }: ConversationComposerProps) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (enterSends(event.key, event.shiftKey, event.nativeEvent.isComposing)) {
      event.preventDefault();
      if (submit.enabled) submit.run();
    }
  };
  return <div className="border-t border-border bg-surface p-3">
    {attachments}
    {editor.label && <label htmlFor={id} className="mb-2 block text-xs font-semibold text-text-body">{editor.label}</label>}
    <div className="flex items-end gap-2">
      {leading}
      <textarea id={id} value={editor.value} onChange={(event) => editor.onChange(event.target.value)}
        onKeyDown={onKeyDown} rows={1} placeholder={editor.placeholder} maxLength={editor.maxLength}
        aria-label={editor.label ?? "消息"}
        className="max-h-40 min-h-[2.5rem] min-w-0 flex-1 resize-none rounded-2xl bg-surface-sunken px-3.5 py-2 text-sm text-text-strong" />
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </div>
    {footer && <div className="mt-2 text-xs leading-relaxed text-text-secondary">{footer}</div>}
  </div>;
}
