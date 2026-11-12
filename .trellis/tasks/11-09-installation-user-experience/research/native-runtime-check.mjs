/** Isolated real WebView role boundary and optional-adapter repair checks, without credential logging. */
import { writeFileSync } from "node:fs";
const pages = await (await fetch("http://127.0.0.1:19224/json")).json();
const home = pages.find((page) => page.url.includes("home.html"));
if (!home) throw new Error("Home is unavailable");
const socket = new WebSocket(home.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data); pending.get(message.id)?.(message); pending.delete(message.id); });
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error("CDP deadline")), 10_000);
    pending.set(requestId, (result) => { clearTimeout(timer); resolve(result.result?.result?.value ?? result); });
    socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}
const result = await evaluate(`(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke;
 const identity=await invoke('local_operator_identity');
 const endpoint=await invoke('local_core_endpoint');
 const result={before:await invoke('get_status'),identity,endpoint};
 result.optionalBefore=await invoke('browser_attachment_pair').then(v=>v?'configured':'disabled',()=> 'unavailable');
 const base={version:1, coreId:'550e8400-e29b-41d4-a716-446655440000',instanceId:'550e8400-e29b-41d4-a716-446655440001',
 endpoint, nonce:'01'.repeat(32),clientNonce:'02'.repeat(32),deviceId:identity,role:'node',expiresAt:Date.now()+30000,serverProof:'03'.repeat(32)};
 result.nodeProofRejected=await invoke('local_operator_proof',{challenge:base}).then(()=>false,()=>true);
 result.foreignIdentityRejected=await invoke('local_operator_proof',{challenge:{...base,role:'operator',deviceId:'550e8400-e29b-41d4-a716-446655440003'}}).then(()=>false,()=>true);
 result.forgedServerRejected=await invoke('local_operator_proof',{challenge:{...base,role:'operator'}}).then(()=>false,()=>true);
 result.setup=await invoke('browser_attachment_setup',{enabled:true});
 await new Promise(r=>setTimeout(r,500));
 result.optionalAfter=await invoke('browser_attachment_pair').then(v=>v?'configured':'disabled',()=> 'unavailable');
 result.disable=await invoke('browser_attachment_setup',{enabled:false});
 await new Promise(r=>setTimeout(r,500));
 result.optionalDisabled=await invoke('browser_attachment_pair').then(v=>v?'configured':'disabled',()=> 'unavailable');
 result.after=await invoke('get_status');
 return result;
})()`);
writeFileSync("G:/taki-native-flow-artifacts-20261110/startup/native-runtime-check.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
socket.close();
