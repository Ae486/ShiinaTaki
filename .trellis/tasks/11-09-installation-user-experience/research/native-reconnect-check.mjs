import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
const root="G:/taki-native-flow-artifacts-20261110/startup";
const fixture=JSON.parse(readFileSync(`${root}/fixture.json`,"utf8"));
const previous=JSON.parse(readFileSync(`${fixture.core}/devices.json`,"utf8"));
const pid=Number(readFileSync(`${root}/core.pid`,"utf8").trim());
process.kill(pid);
await new Promise(r=>setTimeout(r,1000));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith("TAKI_")&&k!=="CREDENTIALS_DIRECTORY"));
Object.assign(env,{TAKI_DATA_DIR:fixture.core,TAKI_WS_PORT:String(fixture.port),TAKI_SECRET_KEY_HELPER:"G:/taki-native-flow-build-20261110/debug/taki-secret-key.exe",TAKI_SECRET_KEY_ACCOUNT:fixture.catalogAccount,TAKI_TRUST_LOOPBACK_OPERATOR:"false",TAKI_AMBIENT_SCREENSHOT:"false",TAKI_INITIATIVE_ENABLED:"false"});
const {openSync}=await import("node:fs");
const child=spawn(process.execPath,["packages/core/src/main.ts"],{cwd:"H:/TakiAgent-worktrees/t4",env,windowsHide:true,detached:true,stdio:["ignore",openSync(`${root}/core-reconnect.stdout.log`,"w"),openSync(`${root}/core-reconnect.stderr.log`,"w")]});
child.unref();writeFileSync(`${root}/core.pid`,String(child.pid));
const started=performance.now();
let snapshots=[];
for(let i=0;i<40;i++){
 await new Promise(r=>setTimeout(r,1000));
 const pages=await(await fetch("http://127.0.0.1:19224/json")).json();
 const home=pages.find(p=>p.url.includes("home.html"));
 const ws=new WebSocket(home.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener("open",r,{once:true}));
 const value=await new Promise(r=>{ws.addEventListener("message",({data})=>r(JSON.parse(data).result?.result?.value),{once:true});ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression:`(async()=>({node:await window.__TAURI_INTERNALS__.invoke('get_status'),text:document.body.innerText}))()`,awaitPromise:true,returnByValue:true}}));});ws.close();
 snapshots.push({elapsedMs:performance.now()-started,node:value?.node,hasReconnect:value?.text?.includes("重连")});
 if(value?.node==="connected"&&!value.text.includes("重连")) break;
}
const next=JSON.parse(readFileSync(`${fixture.core}/devices.json`,"utf8"));
const result={snapshots,deviceIdsStable:JSON.stringify(previous.devices.map(d=>[d.deviceId,d.role,d.tokenHash]))===JSON.stringify(next.devices.map(d=>[d.deviceId,d.role,d.tokenHash])),count:next.devices.length};
writeFileSync(`${root}/core-reconnect-check.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
