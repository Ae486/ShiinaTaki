// Read-only Phase B preflight. No stage allocation, build or launcher invocation.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const OUT=path.dirname(fileURLToPath(import.meta.url));
const T='1b05d2f6-494c-4a6d-a601-1e807eca1486';
const S='G:/TakiAgent-c2a-database/persistence-'+T;
const W='C:/taki-c2a-db-persistence-'+T;
const D='C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const E='npipe:////./pipe/dockerDesktopLinuxEngine';
const record={recordedAt:new Date().toISOString(),caseId:T,commands:[],pins:[],checks:[],failure:null};
const check=(value,name)=>{record.checks.push({name,pass:!!value});if(!value)throw new Error(name);};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const free=p=>{const s=fs.statfsSync(p);return s.bavail*s.bsize;};
async function docker(args){
  const command={program:D,args:['--host',E,'--config',S+'/client-config',...args],stdout:'',stderr:'',failure:null,startedAt:new Date().toISOString()};
  const started=Date.now();record.commands.push(command);
  await new Promise(resolve=>{
    const child=spawn(D,command.args,{cwd:OUT,windowsHide:true,shell:false,env:{SystemRoot:process.env.SystemRoot},stdio:['ignore','pipe','pipe']});
    let count=0;
    const timer=setTimeout(()=>{command.failure='TIMEOUT';child.kill();},15000);
    for(const [s,k]of [[child.stdout,'stdout'],[child.stderr,'stderr']])s.on('data',b=>{count+=b.length;if(count>256*1024){command.failure='OUTPUT_LIMIT';child.kill();}else command[k]+=b.toString('utf8');});
    child.on('error',e=>{command.failure=e.code??e.message;});
    child.on('close',(code,signal)=>{clearTimeout(timer);Object.assign(command,{exitCode:code,signal,elapsedMs:Date.now()-started});resolve();});
  });
  check(command.exitCode===0&&!command.failure,'DOCKER:'+args[0]);return command.stdout;
}
try{
  check(!fs.existsSync(S),'STAGE_ABSENT');check(!fs.existsSync(W),'PROTECTED_ROOT_ABSENT');
  for(const [p,pin]of Object.entries({
    [D]:'0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d',
    'C:/Program Files/nodejs/node.exe':'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de',
    'H:/TakiAgent/apps/desktop/src-tauri/target/debug/taki-node.exe':'1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9'
  })){const actual=hash(p);record.pins.push({path:p,sha256:actual,expected:pin});check(actual===pin,'PIN:'+p);}
  record.freeSpace={gFree:free('G:/'),cFree:free('C:/')};
  check(record.freeSpace.gFree>=20*1024**3,'G_FREE_20_GIB');check(record.freeSpace.cFree>=1024**3,'C_FREE_1_GIB');
  const before=Date.now();
  record.engine=JSON.parse(await docker(['info','--format','{"id":{{json .ID}},"os":{{json .OSType}},"architecture":{{json .Architecture}},"version":{{json .ServerVersion}},"time":{{json .SystemTime}}}']));
  record.clock={windowsBefore:new Date(before).toISOString(),windowsAfter:new Date().toISOString(),engine:record.engine.time};
  check(record.engine.id==='93e8319e-24b7-4a7d-88f1-60923ad681e0'&&record.engine.os==='linux'&&record.engine.architecture==='x86_64'&&record.engine.version==='29.0.1','ENGINE_IDENTITY');
  record.image=JSON.parse(await docker(['image','inspect','--format','{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"volumes":{{json (index .Config "Volumes")}}}','taki-hindsight-api:local']));
  check(record.image.id==='sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db'&&record.image.os==='linux'&&record.image.architecture==='amd64'&&Object.keys(record.image.volumes??{}).length===0,'BASE_IMAGE');
  check((await docker(['image','ls','--filter','reference=taki-c2a-db:'+T,'--format','{{.ID}}'])).trim()==='','TAG_ABSENT');
  const ids=(await docker(['container','ls','--all','--no-trunc','--format','{{.ID}}'])).trim().split(/\r?\n/).filter(Boolean);
  check(ids.length===7&&ids.every(id=>/^[0-9a-f]{64}$/.test(id)),'SEVEN_EXISTING_CONTAINERS');
  record.containers=(await docker(['container','inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}}}',...ids])).trim().split(/\r?\n/).map(s=>JSON.parse(s));
  check(!fs.existsSync(S)&&!fs.existsSync(W),'ROOTS_STILL_ABSENT');
}catch(e){record.failure=e.message;process.exitCode=1;}
record.finishedAt=new Date().toISOString();
fs.writeFileSync(path.join(OUT,'preflight.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record));
