/**
 * INPUT:  authenticated Home client generations and value-free secret presence/write results.
 * OUTPUT: fresh Hindsight key presence and explicit serialized set/clear, with retired results suppressed.
 * POS:    ui/windows/home/pages/settings — encrypted catalog client; no values are retained or writes replayed.
 */
import type { SecretPresenceResult } from "@taki/shared";
import { HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import type { WsClient } from "@/lib/ws-client.js";
import type { FeedbackTone } from "@/components/ui/feedback-line.js";

export const HINDSIGHT_KEY_REF = HINDSIGHT_SECRET_REFS.connectionApiKey;
type KeyClient = Pick<WsClient, "secretPresence" | "secretSet" | "secretClear">;
export interface HindsightKeyState {
  presence: SecretPresenceResult | null;
  loading: boolean;
  busy: "set" | "clear" | null;
  feedback: { tone: FeedbackTone; message: string } | null;
}
export const INITIAL_KEY_STATE: HindsightKeyState = { presence: null, loading: true, busy: null, feedback: null };

interface KeyControllerContext {
  client: KeyClient | null;
  generation: number;
  readToken: number;
  state: HindsightKeyState;
  publish: (state: HindsightKeyState) => void;
}

export function createHindsightKeyController(publish: (state: HindsightKeyState) => void) {
  const context: KeyControllerContext = { client: null, generation: 0, readToken: 0, state: INITIAL_KEY_STATE, publish };
  return {
    replace(target: KeyClient | null) {
      context.generation += 1;
      context.client = target;
      context.state = INITIAL_KEY_STATE;
      publish(context.state);
      if (target) void read(context);
    },
    refresh: () => context.state.busy ? Promise.resolve() : read(context),
    save: (value: string) => mutate(context, "set", value),
    clear: () => mutate(context, "clear"),
    dispose() { context.generation += 1; context.client = null; context.state = INITIAL_KEY_STATE; },
  };
}

async function read(context: KeyControllerContext, feedback: HindsightKeyState["feedback"] = null) {
  const target = context.client;
  if (!target) return;
  const token = context.generation;
  const request = ++context.readToken;
  emit(context, { loading: true, presence: null, feedback });
  try {
    const presence = await target.secretPresence({ secretRef: HINDSIGHT_KEY_REF });
    if (current(context, target, token) && request === context.readToken) emit(context, { presence, loading: false });
  } catch {
    if (current(context, target, token) && request === context.readToken) emit(context, { loading: false, feedback: {
      tone: "danger", message: `${feedback ? `${feedback.message} ` : ""}无法读取最新 API Key 状态，请检查连接后刷新；当前保存状态未知。`,
    } });
  }
}

async function mutate(context: KeyControllerContext, action: "set" | "clear", value?: string) {
  const target = context.client;
  const state = context.state;
  if (!target || state.loading || state.busy || state.presence?.health !== "ok") return;
  if (action === "set" && !value) return;
  const token = context.generation;
  emit(context, { busy: action, feedback: null });
  let feedback: HindsightKeyState["feedback"];
  try {
    if (action === "set" && value) await target.secretSet({ secretRef: HINDSIGHT_KEY_REF, value });
    else await target.secretClear({ secretRef: HINDSIGHT_KEY_REF });
    feedback = { tone: "ok", message: action === "set"
      ? "API Key 已保存。尚未校验连接，请到操作页点击“校验连接”。"
      : "API Key 已清除。现有连接是否可用需重新校验。" };
  } catch (cause) {
    feedback = keyFailure(cause);
  }
  if (!current(context, target, token)) return;
  await read(context, feedback);
  if (current(context, target, token)) emit(context, { busy: null });
}

function emit(context: KeyControllerContext, patch: Partial<HindsightKeyState>) {
  context.state = { ...context.state, ...patch };
  context.publish(context.state);
}

function current(context: KeyControllerContext, target: KeyClient, token: number) {
  return context.client === target && context.generation === token;
}

function keyFailure(cause: unknown): NonNullable<HindsightKeyState["feedback"]> {
  if (typeof cause === "object" && cause !== null && "data" in cause) {
    const data = cause.data;
    if (typeof data === "object" && data !== null && "code" in data && data.code === "SECRET_REFUSED") {
      return { tone: "danger", message: "Core 拒绝了密钥修改；已重新读取保存状态，请检查密钥存储后再操作。" };
    }
  }
  return { tone: "warn", message: "API Key 请求未确认完成，结果未知；已重新读取保存状态，请确认后再操作。" };
}
