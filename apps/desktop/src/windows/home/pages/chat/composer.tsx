/**
 * INPUT:  typed draft/attachments, connection readiness, current send/cancel state, and a retracted draft hand-back.
 * OUTPUT: <Composer> — textarea (Enter=send, Shift+Enter=newline, IME-safe), attach button, thumbnail previews, and a dual-state
 *         pill: 发送 while idle (accent), 中断 (abort the in-flight turn) while sending. Attach-pick problems toast (D34).
 * POS:    ui/windows/home/pages/chat — presentational; owns the image-attach hook. The attach button stays enabled even without a
 *         vision slot (decision 5, v1) — a no-vision send returns chat.error rendered as a toast. Buttons ride the shared
 *         ui/ primitives (batch-2: the private ActionButton is gone; hit targets ≥32px per A7).
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ImageAttachment } from "@taki/shared";
import { pushToast } from "@/components/toast/toast-store.js";
import { ActionButton } from "../../action-button.tsx";
import { IconButton } from "@/components/ui/icon-button.js";
import { ImagePlusIcon } from "@/lib/icons/image-plus-icon.js";
import { useImageAttach, type PickedAttachment } from "./use-image-attach.ts";

interface ComposerProps {
  onSend: (message: string, attachments: ImageAttachment[]) => void;
  onCancel: () => void;
  isSending: boolean;
  retractedDraft: string | null;
  consumeRetractedDraft: () => void;
  connectionReady: boolean;
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
      <IconButton label="添加图片" onClick={() => inputRef.current?.click()}>
        <ImagePlusIcon className="h-5 w-5" />
      </IconButton>
    </>
  );
}

function Thumbnails({ attachments, onRemove }: { attachments: PickedAttachment[]; onRemove: (id: string) => void }) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="relative">
          <img src={attachment.previewUrl} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-black/10" />
          {/* A7: the remove hit target grows to the 32px IconButton; it hangs over the thumbnail corner. */}
          <IconButton
            label="移除图片"
            tone="solid"
            className="absolute -right-3 -top-3"
            onClick={() => onRemove(attachment.id)}
          >
            <span className="text-xs leading-none">×</span>
          </IconButton>
        </div>
      ))}
    </div>
  );
}

// A2 IME safety: an IME composition's Enter (pinyin candidate confirmation) must never send;
// plain Enter sends, Shift+Enter stays a newline. Exported so the regression test rides the real decision.
export function enterSends(key: string, shiftKey: boolean, isComposing: boolean): boolean {
  return !isComposing && key === "Enter" && !shiftKey;
}

export function Composer({ onSend, onCancel, isSending, retractedDraft, consumeRetractedDraft, connectionReady }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const { attachments, pick, remove, clear, notice, dismissNotice } = useImageAttach();
  const canSend = connectionReady && !isSending && (draft.trim().length > 0 || attachments.length > 0);

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
    if (enterSends(event.key, event.shiftKey, event.nativeEvent.isComposing)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border bg-surface p-3">
      {attachments.length > 0 && <Thumbnails attachments={attachments} onRemove={remove} />}
      <div className="flex items-end gap-2">
        <AttachButton onPick={(files) => void pick(files)} />
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="跟 taki 说点什么…"
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl bg-surface-sunken px-3.5 py-2 text-sm text-text-strong"
        />
        {/* The action slot: 发送 while idle (accent pill), 中断 (abort via chat.cancel) while streaming — same position. */}
        {isSending
          ? <ActionButton shape="pill" size="lg" onClick={onCancel}>中断</ActionButton>
          : <ActionButton tone="accent" shape="pill" size="lg" disabled={!canSend} onClick={submit}>发送</ActionButton>}
      </div>
    </div>
  );
}
