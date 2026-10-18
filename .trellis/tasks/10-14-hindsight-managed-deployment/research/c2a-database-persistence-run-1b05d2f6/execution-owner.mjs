// One approved execution only. This owner script records effects; it never edits the reviewed fixture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const OUT=path.dirname(fileURLToPath(import.meta.url));
const R=path.dirname(OUT), REPO='H:/TakiAgent';
const T='1b05d2f6-494c-4a6d-a601-1e807eca1486';
const S='G:/TakiAgent-c2a-database/persistence-'+T, W='C:/taki-c2a-db-persistence-'+T;
const TAG='taki-c2a-db:'+T;
const D='C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const N='C:/Program Files/nodejs/node.exe';
const E='npipe:////./pipe/dockerDesktopLinuxEngine';
const BASE='sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db';
const names=['taki-openbili-backend','taki-hindsight-api-retest','taki-hindsight-api','redis','my_pgvector','rustfs_loacl','rpa-redis','arboris-app'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const fact=(v,s)=>{if(!v)throw Error(s);};
const free=p=>{const s=fs.statfsSync(p);return s.bavail*s.bsize;};
const space=()=>({recordedAt:new Date().toISOString(),gFree:free('G:/'),cFree:free('C:/'),hFree:free('H:/')});
const inputs=()=>{
  const self=read(R+'/c2a-database-persistence-r2-self-check.json');
  const expected={
    [R+'/docker-database/run-persistence.ts']:'c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27',
    [D]:'0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d',
    [N]:'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de',
    [REPO+'/apps/desktop/src-tauri/target/debug/taki-node.exe']:'1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9',
    [R+'/c2a-implementation-source-manifest.json']:'f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2'
  };
  for(const name of ['database-read.py','fake_child.py']){
    const entry=self.caseBinding.files.find(x=>x.file==='docker-database/'+name);
    fact(entry,'SELF_CHECK_ENTRY:'+name);expected[R+'/'+entry.file]=entry.afterSha256;
  }
  const pins=Object.entries(expected).map(([p,expected])=>{
    const sha256=hash(p);fact(sha256===expected,'FROZEN_INPUT_MISMATCH:'+p);
    return {path:p,bytes:fs.statSync(p).size,sha256,expected};
  });
  for(const name of ['run-persistence.ts','database-read.py','fake_child.py']){
    const s=fs.readFileSync(R+'/docker-database/'+name,'utf8');
    fact(s.split(T).length-1===1,'CASE_TOKEN:'+name);
  }
  const accepted=read(R+'/c2a-implementation-source-manifest.json');
  for(const x of accepted.files)fact(hash(x.absolutePath)===x.afterSha256,'ACCEPTED_SOURCE_CHANGED:'+x.absolutePath);
  return {caseId:T,pins,tokenOccurrencesPerFile:1,acceptedSourceEntries:accepted.files.length,recordedAt:new Date().toISOString()};
};
// Read-only calls can run before S exists; all writes stay in the new evidence directory.
async function preDocker(args){
  const rec={program:D,args:['--host',E,'--config',S+'/client-config',...args],startedAt:new Date().toISOString(),stdout:'',stderr:'',failure:null};
  const begin=Date.now();
  await new Promise(resolve=>{
    const c=spawn(D,rec.args,{cwd:OUT,windowsHide:true,shell:false,env:{SystemRoot:process.env.SystemRoot},stdio:['ignore','pipe','pipe']});
    let size=0;const timer=setTimeout(()=>{rec.failure='TIMEOUT';c.kill();},15000);
    for(const [stream,key]of [[c.stdout,'stdout'],[c.stderr,'stderr']])stream.on('data',b=>{size+=b.length;if(size>256*1024){rec.failure='OUTPUT_LIMIT';c.kill();}else rec[key]+=b.toString('utf8');});
    c.on('error',e=>{rec.failure=e.code??e.name;});
    c.on('close',(code,signal)=>{clearTimeout(timer);Object.assign(rec,{exitCode:code,signal,elapsedMs:Date.now()-begin,finishedAt:new Date().toISOString()});resolve();});
  });
  fs.appendFileSync(OUT+'/owner-commands.jsonl',JSON.stringify(rec)+'\n');
  fact(rec.exitCode===0&&!rec.failure,'DOCKER_UNREACHABLE_OR_COMMAND_FAILED:'+args.join(' '));return rec.stdout;
}
const parseLines=s=>s.trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
async function inventory(){return parseLines(await preDocker(['container','inspect','--format','{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}}}',...names]));}
async function engine(){
  const windowsBefore=new Date().toISOString();
  const value=JSON.parse(await preDocker(['info','--format','{"id":{{json .ID}},"os":{{json .OSType}},"architecture":{{json .Architecture}},"version":{{json .ServerVersion}},"time":{{json .SystemTime}}}']));
  const windowsAfter=new Date().toISOString();
  fact(value.id==='93e8319e-24b7-4a7d-88f1-60923ad681e0'&&value.os==='linux'&&value.architecture==='x86_64'&&value.version==='29.0.1','ENGINE_IDENTITY');
  return {value,windowsBefore,windowsAfter};
}
async function prepare(){
  fact(!fs.existsSync(S)&&!fs.existsSync(W),'STAGE_OR_W_COLLISION');
  save(OUT+'/verified-inputs-before.json',inputs());
  const baseline=space();fact(baseline.gFree>=20*1024**3&&baseline.cFree>=1024**3,'FREE_SPACE');
  const engineBefore=await engine();
  const base=JSON.parse(await preDocker(['image','inspect','--format','{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"volumes":{{json (index .Config "Volumes")}}}','taki-hindsight-api:local']));
  fact(base.id===BASE&&base.os==='linux'&&base.architecture==='amd64'&&Object.keys(base.volumes??{}).length===0,'BASE_IDENTITY');
  fact((await preDocker(['image','ls','--filter','reference='+TAG,'--format','{{.ID}}'])).trim()==='','TAG_COLLISION');
  const containers=await inventory();fact(containers.length===8&&containers.every(x=>/^[0-9a-f]{64}$/.test(x.id)),'EIGHT_CONTAINERS');
  const ids=(await preDocker(['container','ls','--all','--no-trunc','--format','{{.ID}}'])).trim().split(/\r?\n/);
  fact(ids.length===8&&containers.every(c=>ids.includes(c.id)),'EIGHT_EXISTING_CONTAINERS');
  const native=read(R+'/c2a-database-persistence-self-check.json').nativeContext;
  fact(native.length===12,'NATIVE_CONTEXT_COUNT');
  for(const x of native)fact(hash(x.path)===x.sha256&&fs.statSync(x.path).size===x.bytes,'NATIVE_SOURCE_CHANGED:'+x.path);
  fact(fs.readdirSync('H:/hindsight/docker/standalone/managed_bootstrap').filter(x=>x.endsWith('.py')).length===11,'ELEVEN_MODULES');
  save(OUT+'/preflight.json',{caseId:T,baseline,engineBefore,base,containers,rootsAbsent:true,tagAbsent:true});
  fact(!fs.existsSync(S)&&!fs.existsSync(W),'ROOT_COLLISION');
  fs.mkdirSync(S);fs.writeFileSync(S+'/.c2a-docker-owner',T,{flag:'wx'});
  fs.mkdirSync(S+'/client-config');fs.mkdirSync(S+'/build-config');
  save(S+'/build-config/config.json',{cliPluginsExtraDirs:['C:/Program Files/Docker/Docker/resources/cli-plugins']});
  save(S+'/baseline.json',baseline);
  const manifest=[];
  for(const x of native){
    const relative=x.path.slice('H:/hindsight/'.length),replacement=relative.endsWith('/fake_child.py');
    const source=replacement?R+'/docker-database/fake_child.py':x.path,target=S+'/context/'+relative;
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
    const sha256=hash(target);fact(sha256===hash(source),'STAGE_HASH:'+relative);
    manifest.push({path:relative,source,bytes:fs.statSync(target).size,sha256,upstreamSha256:x.sha256,replacement});
  }
  save(S+'/context-manifest.json',manifest);
  fs.mkdirSync(S+'/frozen-inputs');
  const frozen=['docker-database/run-persistence.ts','docker-database/database-read.py','docker-database/fake_child.py','docker-database/README.md','c2a-database-persistence-r2-self-check.json','c2a-database-persistence-exact-byte-review-round2-1b05d2f6.md','c2a-database-persistence-exact-byte-review-round2-1b05d2f6.json','c2a-implementation-source-manifest.json'];
  save(S+'/frozen-inputs-manifest.json',frozen.map(relative=>{
    const dest=S+'/frozen-inputs/'+relative;fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(R+'/'+relative,dest,fs.constants.COPYFILE_EXCL);
    return {path:relative,sha256:hash(dest),bytes:fs.statSync(dest).size};
  }));
  console.log(JSON.stringify({stage:'prepared',caseId:T,baseline,containers,contextFiles:manifest.length}));
}
async function buildRun(){
  const {run,docker}=await import(pathToFileURL(S+'/command-runner.mjs').href);
  save(S+'/verified-inputs-immediately-before.json',inputs());
  const rust='C:/Users/55473/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustc.exe';
  fact(fs.existsSync(rust),'RUST_COMPILER_ABSENT');
  const env={};
  for(const k of ['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','ProgramFiles','ProgramFiles(x86)','ProgramW6432','ProgramData','USERPROFILE','LOCALAPPDATA','APPDATA','LIB','LIBPATH','INCLUDE','VCToolsInstallDir','VSINSTALLDIR','WindowsSdkDir','WindowsSDKVersion'])if(process.env[k])env[k]=process.env[k];
  env.TEMP=S;env.TMP=S;
  const version=await run(rust,['--version'],{env});
  await run(rust,[REPO+'/apps/hindsight-host/test-fixtures/fake-key-adapter.rs','--edition=2021','-C','debuginfo=0','-o',S+'/fake-key-adapter.exe'],{timeout:60000,env});
  save(S+'/adapter-build.json',{compiler:rust,compilerSha256:hash(rust),version:version.stdout.trim(),sourceSha256:hash(REPO+'/apps/hindsight-host/test-fixtures/fake-key-adapter.rs'),outputSha256:hash(S+'/fake-key-adapter.exe'),environmentKeys:Object.keys(env)});
  const builder=await docker(['buildx','inspect'],{buildConfig:true});
  fact(/Name:\s+default/.test(builder.stdout)&&/Driver:\s+docker\s/.test(builder.stdout)&&/Status:\s+running/.test(builder.stdout),'BUILDER_IDENTITY');
  const endpoint=await docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}','default'],{buildConfig:true});
  fact(JSON.parse(endpoint.stdout)===E,'BUILDER_ENDPOINT');
  const base=await docker(['image','inspect','--format','{{.Id}}','taki-hindsight-api:local']);fact(base.stdout.trim()===BASE,'BASE_BEFORE_BUILD');
  fact((await docker(['image','ls','--filter','reference='+TAG,'--format','{{.ID}}'])).stdout.trim()==='','TAG_BEFORE_BUILD');
  fs.writeFileSync(S+'/build.started',new Date().toISOString(),{flag:'wx'});
  const b=await docker(['buildx','build','--builder','default','--pull=false','--network=none','--load','--progress=plain','--build-arg','NATIVE_IMAGE=taki-hindsight-api:local','--label','taki.c2a.fixture='+T,'--iidfile',S+'/image-id.txt','--tag',TAG,'--file',S+'/context/docker/standalone/Dockerfile.c2a-fake',S+'/context'],{buildConfig:true,timeout:600000,allowFailure:true});
  fs.writeFileSync(S+'/build.stdout.log',b.stdout,{flag:'wx'});fs.writeFileSync(S+'/build.stderr.log',b.stderr,{flag:'wx'});save(S+'/build-result.json',b);
  fact(b.exitCode===0&&!b.failure,'BUILD_FAILED_NO_RETRY');
  const imageId=fs.readFileSync(S+'/image-id.txt','utf8').trim();fact(/^sha256:[0-9a-f]{64}$/.test(imageId)&&imageId!==BASE,'RESULT_IMAGE_ID');
  const image=JSON.parse((await docker(['image','inspect',TAG])).stdout)[0];fact(image.Id===imageId&&image.Config.Labels?.['taki.c2a.fixture']===T,'RESULT_IMAGE_BINDING');
  save(S+'/result-image.json',image);
  console.log(JSON.stringify({stage:'build-completed',exitCode:b.exitCode,elapsedMs:b.elapsedMs,imageId}));
  save(S+'/verified-inputs-before-launch.json',inputs());
  fact(!fs.existsSync(W)&&!fs.existsSync(S+'/persistence.started'),'LAUNCH_COLLISION');
  fs.writeFileSync(S+'/launcher-dispatched',new Date().toISOString(),{flag:'wx'});
  console.log(JSON.stringify({stage:'launcher-started',at:new Date().toISOString(),deadlineMs:1200000}));
  const l=await run(N,[R+'/docker-database/run-persistence.ts','--execute-approved-persistence'],{timeout:1200000,allowFailure:true,env:{SystemRoot:process.env.SystemRoot,TEMP:S,TMP:S,WS_NO_BUFFER_UTIL:'1',WS_NO_UTF_8_VALIDATE:'1'}});
  fs.writeFileSync(S+'/launcher.stdout.log',l.stdout,{flag:'wx'});fs.writeFileSync(S+'/launcher.stderr.log',l.stderr,{flag:'wx'});save(S+'/launcher-result.json',l);
  console.log(l.stdout);console.log(JSON.stringify({stage:'launcher-exited',exitCode:l.exitCode,failure:l.failure,elapsedMs:l.elapsedMs}));
  if(l.exitCode!==0||l.failure)process.exitCode=1;
}
async function verifyAfter(){
  const before=read(OUT+'/preflight.json');const containers=await inventory(),engineAfter=await engine();
  const comparisons=before.containers.map(b=>{const a=containers.find(x=>x.name===b.name);return {name:b.name,before:b,after:a,idUnchanged:a?.id===b.id,startTimeUnchanged:a?.startedAt===b.startedAt};});
  const tagAbsent=(await preDocker(['image','ls','--filter','reference='+TAG,'--format','{{.ID}}'])).trim()==='';
  const resources={containers:(await preDocker(['container','ls','--all','--no-trunc','--filter','label=taki.c2a.fixture='+T,'--format','{{.ID}}'])).trim(),volumes:(await preDocker(['volume','ls','--filter','label=taki.c2a.fixture='+T,'--format','{{.Name}}'])).trim()};
  const after=space(),delta={gFree:after.gFree-before.baseline.gFree,cFree:after.cFree-before.baseline.cFree,hFree:after.hFree-before.baseline.hFree};
  const allUnchanged=comparisons.every(x=>x.idUnchanged&&x.startTimeUnchanged);
  const record={caseId:T,engineAfter,comparisons,allEightUnchanged:allUnchanged,tagAbsent,protectedRootAbsent:!fs.existsSync(W),stageRetained:fs.existsSync(S),resources,space:{before:before.baseline,after,delta},verifiedInputs:inputs()};
  save(OUT+'/post-run-verification.json',record);console.log(JSON.stringify(record));
  fact(allUnchanged&&tagAbsent&&!fs.existsSync(W),'POST_RUN_VERIFICATION');
}
try{
  if(process.argv[2]==='prepare')await prepare();
  else if(process.argv[2]==='build-run')await buildRun();
  else if(process.argv[2]==='verify-after')await verifyAfter();
  else throw Error('UNKNOWN_MODE');
}catch(e){
  const record={mode:process.argv[2],at:new Date().toISOString(),error:e.message,stack:e.stack,stageExists:fs.existsSync(S),protectedRootExists:fs.existsSync(W)};
  save(OUT+'/owner-failure-'+process.argv[2]+'.json',record);console.error(JSON.stringify(record));process.exitCode=1;
}
