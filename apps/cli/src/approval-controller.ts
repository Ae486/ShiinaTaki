/**
 * INPUT:  canonical Approval request/closed events, one CLI WsClient generation, and cancellable stdin reads
 * OUTPUT: createCliApprovalController() -> socket-local FIFO prompt lifecycle with bounded response outcomes
 * POS:    cli — the only interactive Approval owner; raw requests remain in memory and never enter history/cache
 */
import type {
  ApprovalChoice,
  ApprovalClosed,
  CanonicalApprovalRequest,
  CanonicalApprovalRespondParams,
  CanonicalApprovalRespondResult,
} from "@taki/shared";
import {
  approvalStatusMessage,
  parseApprovalAnswer,
  parseApprovalDisclosure,
  renderApprovalAsk,
  renderApprovalDisclosure,
} from "./approval-prompt.ts";

export type CliApprovalEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

export interface CliApprovalClient {
  approvalRespond(params: CanonicalApprovalRespondParams): Promise<CanonicalApprovalRespondResult>;
}

export interface CliApprovalController {
  replace(client: CliApprovalClient | null): void;
  receive(event: CliApprovalEvent): void;
  dispose(): void;
}

interface PromptState {
  request: CanonicalApprovalRequest;
  token: number;
  abort: AbortController;
}

interface ControllerState {
  client: CliApprovalClient | null;
  epoch: number;
  pending: Map<string, CanonicalApprovalRequest>;
  active: PromptState | null;
  expiryTimers: Map<string, ReturnType<typeof setTimeout>>;
}

interface ControllerIo {
  ask: (query: string, signal?: AbortSignal) => Promise<string | null>;
  write: (message: string) => void;
}

interface QueueRuntime {
  input: ControllerIo;
  pump: () => void;
}

export function createCliApprovalController(input: {
  ask: (query: string, signal?: AbortSignal) => Promise<string | null>;
  write: (message: string) => void;
}): CliApprovalController {
  const state: ControllerState = { client: null, epoch: 0, pending: new Map(), active: null, expiryTimers: new Map() };
  const pump = (): void => pumpQueue(state, input, pump);

  return {
    replace: (client) => replaceClient(state, client, pump),
    receive: (event) => receiveEvent(state, { input, pump }, event),
    dispose: () => replaceClient(state, null, () => undefined),
  };
}

function pumpQueue(state: ControllerState, input: ControllerIo, pump: () => void): void {
  if (state.active || !state.client) return;
  const request = state.pending.values().next().value as CanonicalApprovalRequest | undefined;
  if (!request) return;
  const active: PromptState = { request, token: state.epoch, abort: new AbortController() };
  state.active = active;
  void runPrompt(state, input, active).finally(() => finishPrompt(state, active, pump));
}

function finishPrompt(state: ControllerState, active: PromptState, pump: () => void): void {
  if (state.active !== active) return;
  state.active = null;
  state.pending.delete(active.request.approvalId);
  clearExpiry(state, active.request.approvalId);
  pump();
}

function replaceClient(state: ControllerState, client: CliApprovalClient | null, pump: () => void): void {
  state.epoch += 1;
  state.active?.abort.abort();
  state.active = null;
  state.pending.clear();
  for (const id of state.expiryTimers.keys()) clearExpiry(state, id);
  state.client = client;
  pump();
}

function receiveEvent(state: ControllerState, runtime: QueueRuntime, event: CliApprovalEvent): void {
  if (event.type === "closed") {
    retireClosed(state, runtime.input, event.closed);
    runtime.pump();
    return;
  }
  if (state.pending.has(event.request.approvalId)) return;
  state.pending.set(event.request.approvalId, event.request);
  scheduleExpiry(state, runtime, event.request);
  runtime.pump();
}

function scheduleExpiry(state: ControllerState, runtime: QueueRuntime, request: CanonicalApprovalRequest): void {
  const delay = Math.max(0, Date.parse(request.expiresAt) - Date.now());
  state.expiryTimers.set(request.approvalId, setTimeout(() => {
    if (!state.pending.has(request.approvalId)) return;
    if (state.active?.request.approvalId === request.approvalId) state.active.abort.abort();
    state.pending.delete(request.approvalId);
    clearExpiry(state, request.approvalId);
    runtime.input.write("[approval] request expired locally; no authorization was sent.\n");
    runtime.pump();
  }, delay));
}

async function runPrompt(
  state: { client: CliApprovalClient | null; epoch: number; pending: Map<string, CanonicalApprovalRequest> },
  input: { ask: (query: string, signal?: AbortSignal) => Promise<string | null>; write: (message: string) => void },
  active: PromptState,
): Promise<void> {
  const { request, abort } = active;
  const answer = await input.ask(renderApprovalAsk(request), abort.signal);
  if (abort.signal.aborted || !isCurrent(state, active)) return;
  if (answer === null) {
    await denyOnClosedInput(state, input, active);
    return;
  }
  const choice = await readChoice(input, { request, first: answer, signal: abort.signal });
  if (abort.signal.aborted || !isCurrent(state, active)) return;
  let disclosure: { revision: 1; futureBackgroundUseAccepted: true } | undefined;
  let selected = choice;
  if (choice === "allow_always") {
    const disclosureAnswer = await input.ask(renderApprovalDisclosure(request), abort.signal);
    if (abort.signal.aborted || !isCurrent(state, active)) return;
    const confirmed = disclosureAnswer !== null && parseApprovalDisclosure(disclosureAnswer);
    if (!confirmed || request.disclosureRevision === undefined) {
      input.write("[approval] future-background disclosure was not confirmed; denying this request.\n");
      selected = "deny";
    } else {
      disclosure = { revision: request.disclosureRevision, futureBackgroundUseAccepted: true };
    }
  }
  const client = state.client;
  if (!client || !isCurrent(state, active)) return;
  let result: CanonicalApprovalRespondResult;
  try {
    result = await client.approvalRespond({
      approvalId: request.approvalId,
      choice: selected,
      expectedApprovalGeneration: request.approvalGeneration,
      ...(disclosure ? { disclosure } : {}),
    });
  } catch {
    if (isCurrent(state, active)) input.write("[approval] response failed; no authorization was assumed.\n");
    return;
  }
  if (!isCurrent(state, active)) return;
  if (result.status !== "accepted") input.write(`[approval] ${approvalStatusMessage(result.status)}\n`);
}

async function readChoice(
  input: ControllerIo,
  prompt: { request: CanonicalApprovalRequest; first: string; signal: AbortSignal },
): Promise<ApprovalChoice> {
  let answer = prompt.first;
  for (;;) {
    if (prompt.signal.aborted) return "deny";
    const choice = parseApprovalAnswer(answer, prompt.request.allowedChoices);
    if (choice) return choice;
    input.write("[approval] choose one of the displayed options.\n");
    const next = await input.ask(renderApprovalAsk(prompt.request), prompt.signal);
    if (next === null) return "deny";
    answer = next;
  }
}

async function denyOnClosedInput(
  state: { client: CliApprovalClient | null; epoch: number; pending: Map<string, CanonicalApprovalRequest> },
  input: { ask: (query: string, signal?: AbortSignal) => Promise<string | null>; write: (message: string) => void },
  active: PromptState,
): Promise<void> {
  const client = state.client;
  if (!client || !isCurrent(state, active)) return;
  try {
    await client.approvalRespond({ approvalId: active.request.approvalId, choice: "deny", expectedApprovalGeneration: active.request.approvalGeneration });
    input.write("[approval] input closed; request denied without authorization.\n");
  } catch {
    input.write("[approval] input closed; authorization was not assumed.\n");
  }
}

function retireClosed(
  state: {
    pending: Map<string, CanonicalApprovalRequest>;
    active: PromptState | null;
    expiryTimers: Map<string, ReturnType<typeof setTimeout>>;
  },
  input: { write: (message: string) => void },
  closed: ApprovalClosed,
): void {
  const existed = state.pending.delete(closed.approvalId);
  if (!existed) return;
  clearExpiry(state, closed.approvalId);
  if (state.active?.request.approvalId === closed.approvalId) {
    state.active.abort.abort();
    input.write(`[approval] request closed (${closed.reason}); prompt retired.\n`);
  }
}

function clearExpiry(state: { expiryTimers: Map<string, ReturnType<typeof setTimeout>> }, id: string): void {
  const timer = state.expiryTimers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  state.expiryTimers.delete(id);
}

function isCurrent(state: { client: CliApprovalClient | null; epoch: number; pending: Map<string, CanonicalApprovalRequest> }, active: PromptState): boolean {
  return state.client !== null && state.epoch === active.token && state.pending.has(active.request.approvalId);
}
