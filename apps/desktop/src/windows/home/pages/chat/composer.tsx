/**
 * INPUT:  typed draft/attachments, connection readiness, current send/cancel state, and a retracted draft hand-back.
 * OUTPUT: <Composer> — textarea (Enter=send, Shift+Enter=newline, IME-safe), attach button, thumbnail previews, and a dual-state
 *         pill: 发送 while idle (accent), 中断 (abort the in-flight turn) while sending. Attach-pick problems toast (D34).
 * POS:    ui/windows/home/pages/chat — presentational; owns the image-attach hook. The attach button stays enabled even without a
 *         vision slot (decision 5, v1) — a no-vision send returns chat.error rendered as a toast. Buttons ride the shared
 *         ui/ primitives (batch-2: the private ActionButton is gone; hit targets ≥32px per A7).
 */

import { useEffect, useRef, useState } from "react";
import type { ImageAttachment } from "@taki/shared";
import { pushToast } from "@/components/toast/toast-store.js";
import { ActionButton } from "../../action-button.tsx";
import { IconButton } from "@/components/ui/icon-button.js";
import { ImagePlusIcon } from "@/lib/icons/image-plus-icon.js";
import { useImageAttach, type PickedAttachment } from "./use-image-attach.ts";
import { ConversationComposer } from "./conversation-composer.tsx";

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

export function Composer({ onSend, onCancel, isSending, retractedDraft, consumeRetractedDraft, connectionReady }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const { attachments, pick, remove, clear } = useImageAttach();
  const canSend = connectionReady && !isSending && (draft.trim().length > 0 || attachments.length > 0);

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
  return <ConversationComposer editor={{ value: draft, onChange: setDraft, placeholder: "跟 taki 说点什么…" }}
    submit={{ enabled: canSend, run: submit }}
    attachments={attachments.length > 0 ? <Thumbnails attachments={attachments} onRemove={remove} /> : null}
    leading={<AttachButton onPick={(files) => void pick(files)} />}
    actions={isSending
      ? <ActionButton shape="pill" size="lg" onClick={onCancel}>中断</ActionButton>
      : <ActionButton tone="accent" shape="pill" size="lg" disabled={!canSend} onClick={submit}>发送</ActionButton>} />;
}
