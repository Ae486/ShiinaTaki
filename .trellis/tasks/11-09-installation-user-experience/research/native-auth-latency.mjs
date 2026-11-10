/** Measures local handshake lifecycle overhead through the actual native proof command; never exports proofs or tokens. */
import { writeFileSync } from "node:fs";
const pages=await(await fetch("http://127.0.0.1:19224/json")).json();
const home=pages.find(page=>page.url.includes("home.html"));
const socket=new WebSocket(home.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener("open",resolve,{once:true}));
const response=new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error("Handshake benchmark deadline")),30000);
 socket.addEventListener("message",({data})=>{clearTimeout(timer);resolve(JSON.parse(data));},{once:true});
});
socket.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{returnByValue:true,awaitPromise:true,expression:`(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,endpoint=await invoke('local_core_endpoint'),deviceId=await invoke('local_operator_identity');
 const times=[];
 for(let i=0;i<20;i++){
  const started=performance.now(), ws=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const request=params=>new Promise((resolve,reject)=>{ws.onmessage=event=>resolve(JSON.parse(event.data));ws.onerror=reject;ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'connect',params}));});
  const base={deviceId,deviceName:'native-latency-fixture',role:'operator',capabilities:[]};
  const clientNonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const begin=await request({...base,localAuth:{kind:'begin',clientNonce}});
  const challenge=begin.error.data.challenge;
  const proof=await invoke('local_operator_proof',{challenge});
  const accepted=await request({...base,localAuth:{kind:'proof',nonce:challenge.nonce,proof}});
  if(accepted.result?.status!=='ok')throw Error('Fixture connection refused');
  await new Promise(resolve=>{ws.onclose=resolve;ws.close();});
  times.push(performance.now()-started);
 }
 times.sort((a,b)=>a-b);return {samples:times.length,medianMs:times[10],p95Ms:times[18],maxMs:times[19],durationMs:times.reduce((a,b)=>a+b,0)};
})()`}}));
const result=await response;
socket.close();
const value=result.result?.result?.value??result;
writeFileSync("G:/taki-native-flow-artifacts-20261110/startup/native-auth-latency.json",JSON.stringify(value,null,2));
console.log(JSON.stringify(value,null,2));
