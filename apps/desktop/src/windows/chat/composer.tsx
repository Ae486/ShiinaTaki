/**
 * INPUT:  the user's typed draft + picked image attachments (useImageAttach); an isSending flag from the hook.
 * OUTPUT: <Composer> — textarea (Enter=send, Shift+Enter=newline), attach button, thumbnail previews, send button.
 *         Calls onSend(message, attachments) then clears; send is disabled while a turn is in-flight or the row is empty.
 * POS:    ui/windows/chat — presentational; owns the image-attach hook. The attach button stays enabled even without a
 *         vision slot (decision 5, v1) — a no-vision send returns chat.error rendered as an inline timeline notice.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment } from "@taki/shared";
import { useImageAttach, type PickedAttachment } from "./use-image-attach.ts";

interface ComposerProps {
  onSend: (message: string, attachments: ImageAttachment[]) => void;
  isSending: boolean;
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
        className="rounded-full px-2 py-1.5 text-lg text-slate-500 hover:bg-slate-100"
        aria-label="Attach image"
        title="添加图片"
      >
        🖼
      </button>
    </>
  );
}

function NoticeBar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="text-amber-500 hover:text-amber-700" aria-label="Dismiss">
        ×
      </button>
    </div>
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

export function Composer({ onSend, isSending }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const { attachments, pick, remove, clear, notice, dismissNotice } = useImageAttach();
  const canSend = !isSending && (draft.trim().length > 0 || attachments.length > 0);

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
      {notice && <NoticeBar message={notice} onDismiss={dismissNotice} />}
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
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="rounded-full bg-rose-400 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
