/** Isolated existing Pet navigates to a local opaque page to verify native origin refusal, then restores itself. */
import { writeFileSync } from "node:fs";
const pages=await(await fetch("http://127.0.0.1:19224/json")).json();
const pet=pages.find(page=>page.url.includes("pet.html"));
if(!pet) throw new Error("Pet missing");
const socket=new WebSocket(pet.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener("open",resolve,{once:true}));
let id=0;
const pending=new Map();
socket.addEventListener("message",({data})=>{const message=JSON.parse(data);pending.get(message.id)?.(message);pending.delete(message.id);});
function call(method,params={}){return new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>reject(new Error("CDP deadline")),10000);pending.set(request,result=>{clearTimeout(timer);resolve(result.result??result);});socket.send(JSON.stringify({id:request,method,params}));});}
let observed;
try {
 await call("Page.navigate",{url:"data:text/html,%3Ctitle%3EIsolated%20origin%20fixture%3C/title%3E"});
 await new Promise(resolve=>setTimeout(resolve,300));
 const result=await call("Runtime.evaluate",{returnByValue:true,awaitPromise:true,expression:`(async()=>({origin:location.origin,nativeAvailable:!!window.__TAURI_INTERNALS__,result:window.__TAURI_INTERNALS__?await window.__TAURI_INTERNALS__.invoke('local_operator_identity').then(()=> 'unexpected-allowed',()=> 'rejected'):'bridge-absent'}))()`});
 observed=result.result?.value??result;
} finally {
 await call("Page.navigate",{url:pet.url});
 socket.close();
}
writeFileSync("G:/taki-native-flow-artifacts-20261110/startup/native-origin-check.json",JSON.stringify(observed,null,2));
console.log(JSON.stringify(observed,null,2));
