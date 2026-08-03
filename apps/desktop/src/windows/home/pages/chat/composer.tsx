/**
 * INPUT:  the user's typed draft + picked image attachments (useImageAttach); an isSending flag + onCancel from the
 *         hook; a retractedDraft (cancel-before-reply) to restore, with a consume callback.
 * OUTPUT: <Composer> — textarea (Enter=send, Shift+Enter=newline), attach button, thumbnail previews, and a dual-state
 *         action button: 发送 while idle, 中断 (abort the in-flight turn) while sending. Attach-pick problems toast (D34).
 * POS:    ui/windows/home/pages/chat — presentational; owns the image-attach hook. The attach button stays enabled even without a
 *         vision slot (decision 5, v1) — a no-vision send returns chat.error rendered as a toast.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment } from "@taki/shared";
import { pushToast } from "@/components/toast/toast-store.js";
import { useImageAttach, type PickedAttachment } from "./use-image-attach.ts";

interface ComposerProps {
  onSend: (message: string, attachments: ImageAttachment[]) => void;
  onCancel: () => void;
  isSending: boolean;
  retractedDraft: string | null;
  consumeRetractedDraft: () => void;
}

// Owns the hidden file input + its ref (the ref belongs with the input, and keeps Composer's render lean).
function AttachButton({ onPick }: { onPick: (files: FileList | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onPick(event.target.files);
          event.target.value = ""; // let the same file be re-picked after a remove
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
        aria-label="Attach image"
        title="添加图片"
      >
        {/* Inline SVG, not an emoji glyph: WebView2's fallback fonts can render pictographs invisibly. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
    </>
  );
}

function Thumbnails({ attachments, onRemove }: { attachments: PickedAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="relative">
          <img src={attachment.previewUrl} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-black/10" />
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-white"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// The action slot: 发送 while idle, 中断 (abort via chat.cancel) while a turn streams — same position, two states.
function ActionButton({ isSending, canSend, onSubmit, onCancel }: { isSending: boolean; canSend: boolean; onSubmit: () => void; onCancel: () => void }) {
  if (isSending) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full border border-rose-300 px-4 py-2 text-sm font-medium text-rose-500 transition-colors hover:bg-rose-50"
      >
        中断
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={!canSend}
      className="rounded-full bg-rose-400 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
    >
      发送
    </button>
  );
}

export function Composer({ onSend, onCancel, isSending, retractedDraft, consumeRetractedDraft }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const { attachments, pick, remove, clear, notice, dismissNotice } = useImageAttach();
  const canSend = !isSending && (draft.trim().length > 0 || attachments.length > 0);

  // Attach-pick problems (unsupported type, decode failure) surface as toasts (D34) — no layout-height notice bar.
  useEffect(() => {
    if (notice) {
      pushToast(notice);
      dismissNotice();
    }
  }, [notice, dismissNotice]);

  // Cancel-before-reply hands the retracted text back: restore it into an EMPTY composer, but NEVER overwrite a
  // draft the user already started — surface it as an info toast instead. One-shot: consume it either way.
  useEffect(() => {
    if (retractedDraft === null) return;
    if (draft.trim().length === 0) setDraft(retractedDraft);
    else pushToast(`已撤回：${retractedDraft}`, "info");
    consumeRetractedDraft();
  }, [retractedDraft, draft, consumeRetractedDraft]);

  const submit = () => {
    if (!canSend) return;
    onSend(draft.trim(), attachments.map((a) => ({ mediaType: a.mediaType, dataBase64: a.dataBase64 })));
    setDraft("");
    clear();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      {attachments.length > 0 && <Thumbnails attachments={attachments} onRemove={remove} />}
      <div className="flex items-end gap-2">
        <AttachButton onPick={(files) => void pick(files)} />
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="跟 taki 说点什么…"
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl bg-slate-100 px-3.5 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-300"
        />
        <ActionButton isSending={isSending} canSend={canSend} onSubmit={submit} onCancel={onCancel} />
      </div>
    </div>
  );
}
