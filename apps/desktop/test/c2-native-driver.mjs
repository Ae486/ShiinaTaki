/**
 * INPUT: an owned WebView2 CDP endpoint and isolated native window labels
 * OUTPUT: bounded CDP calls, actual trusted browser input and native self-window transitions
 * POS: native QA plumbing — no production state or report construction
 */
import { once } from "node:events";
import { setTimeout, clearTimeout } from "node:timers";
const { WebSocket } = globalThis;

export const delay = (ms) => new Promise((done) => setTimeout(done, ms));
export async function waitFor(callback, message, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const result = await callback(); if (result) return result; }
    catch (cause) { last = cause; }
    await delay(100);
  }
  throw new Error(`Timed out: ${message}${last ? ` (${String(last)})` : ""}`);
}

export async function connectCdp(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, "open");
  const pending = new Map(); let id = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error))); else waiter.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout ${method}`)); }, 10_000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { call, close: () => socket.close(), async evaluate(expression) {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } };
}

export function nativeWindow(session, label, operation) {
  return session.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(`plugin:window|${operation}`)}, {label:${JSON.stringify(label)}})`);
}
export async function trustedClick(session, point = { x: 500, y: 70 }) {
  await session.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await session.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
export function clickText(session, text) {
  return session.evaluate(`(() => {const button = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw Error('Missing button'); button.click();})()`);
}
