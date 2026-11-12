/** Isolated native UI observation; records own-window text and redacted auth frame metadata only. */
import { writeFileSync } from "node:fs";
const [mode = "snapshot", output = "G:/taki-native-flow-artifacts-20261110/startup"] = process.argv.slice(2);
const pages = await (await fetch("http://127.0.0.1:19224/json")).json();

async function attach(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  const frames = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      pending.get(message.id)?.(message); pending.delete(message.id);
    }
    if (message.method === "Network.webSocketFrameSent" || message.method === "Network.webSocketFrameReceived") {
      try {
        const frame = JSON.parse(message.params.response.payloadData);
        if (frame.method === "connect" || frame.result?.status === "ok" || frame.error?.data?.code?.startsWith("LOCAL_AUTH")) {
          frames.push({ direction: message.method.endsWith("Sent") ? "sent" : "received", method: frame.method,
            kind: frame.params?.localAuth?.kind, role: frame.params?.role, deviceId: frame.params?.deviceId,
            hasToken: !!frame.params?.token, code: frame.error?.data?.code, accepted: frame.result?.status === "ok" });
        }
      } catch { /* Non-RPC payloads are irrelevant to this scoped probe. */ }
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP deadline: ${method}`)); }, 15_000);
    pending.set(requestId, (result) => { clearTimeout(timer); result.error ? reject(new Error(result.error.message)) : resolve(result.result); });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, send, frames };
}

const results = [];
for (const page of pages) {
  const client = await attach(page);
  await client.send("Network.enable");
  if (mode === "reload") {
    await client.send("Page.reload", { ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const result = await client.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true,
    expression: `(async()=>({ title:document.title,url:location.href, text:document.body.innerText.slice(0,10000),
      status:await window.__TAURI_INTERNALS__.invoke('get_status').catch(String),
      operator:await window.__TAURI_INTERNALS__.invoke('local_operator_identity').catch(String),
      endpoint:await window.__TAURI_INTERNALS__.invoke('local_core_endpoint').catch(String),
      storageKeys:Object.keys(localStorage) }))()` });
  const value = result.result?.value ?? result;
  results.push({ ...value, frames: client.frames });
  if (page.url.includes("home.html")) {
    const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${output}/${mode}-home.png`, Buffer.from(screenshot.data, "base64"));
  }
  client.socket.close();
}
writeFileSync(`${output}/${mode}-probe.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
