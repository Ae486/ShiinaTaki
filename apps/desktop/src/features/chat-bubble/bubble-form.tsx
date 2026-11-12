/**
 * INPUT:  local draft/readiness behavior and explicit bubble controls
 * OUTPUT: the fixed, focus-stable Pet composer with visible controls and safe draft restoration
 * POS:    ui/chat-bubble — input surface; streamed content and occupied-space transitions render below it
 */
import { openHome } from "@/lib/open-home-window.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { IconButton } from "@/components/ui/icon-button.js";
import { ExternalLinkIcon } from "@/lib/icons/external-link-icon.js";
import { XIcon } from "@/lib/icons/x-icon.js";
import { useBubbleForm, type BubbleFormInput } from "./use-bubble-form.ts";

function OpenChatButton() {
  const open = () => openHome("chat").catch((cause: unknown) => {
    console.error("home window failed to open", cause);
    pushToast(`无法打开聊天页: ${cause instanceof Error ? cause.message : String(cause)}`);
  });
  return <IconButton label="打开聊天页" size="sm" onClick={() => void open()}>
    <ExternalLinkIcon className="h-4 w-4" />
  </IconButton>;
}

export function BubbleForm(input: BubbleFormInput) {
  const form = useBubbleForm(input);
  return (
    <form onSubmit={form.onSubmit} data-keep-interactive data-pet-bubble-composer
      className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-surface/95 px-2 py-1 shadow-overlay ring-1 ring-black/5">
      <input ref={form.inputRef} value={form.draft} onChange={(event) => form.setDraft(event.target.value)}
        onKeyDown={form.onKeyDown} placeholder="跟 taki 说点什么…" aria-label="给 taki 的消息"
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-text-strong outline-none" />
      <ActionButton tone="accent" shape="pill" disabled={!form.canSubmit} onClick={form.submit}>
        {input.isPending ? "…" : "发送"}
      </ActionButton>
      <OpenChatButton />
      <IconButton label="关闭" size="sm" className="-mr-0.5" onClick={input.close}>
        <XIcon className="h-4 w-4" />
      </IconButton>
    </form>
  );
}
