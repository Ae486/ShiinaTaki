import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { STAGE,TOKEN,DOCKER,ENDPOINT,docker,run,assertFact,capacity } from './command-runner.mjs';
const save=(name,value)=>writeFileSync(STAGE+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const base='sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db';
const tag='taki-c2a-db:'+TOKEN;
const pins={
  [DOCKER]:'0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d',
  'C:/Program Files/nodejs/node.exe':'9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de',
  'C:/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe':'c8d20cd80c940cf866717dd938eca50dbe588e06e0c0ced5a9d97b06b27bf8a7',
  'H:/TakiAgent/apps/desktop/src-tauri/target/debug/taki-node.exe':'1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9'
};
const inputs=JSON.parse(readFileSync(STAGE+'/prepared-inputs.json','utf8'));
for(const entry of inputs.files)assertFact(hash(entry.path)===entry.sha256,'INPUT_PIN:'+entry.path);
for(const [path,expected]of Object.entries(pins))assertFact(hash(path)===expected,'BINARY_PIN:'+path);
assertFact(!existsSync('C:/taki-c2a-db-persistence-'+TOKEN),'PROTECTED_ROOT_EXISTS');
const info=JSON.parse((await docker(['info','--format','{"id":{{json .ID}},"os":{{json .OSType}},"architecture":{{json .Architecture}},"version":{{json .ServerVersion}},"liveRestore":{{json .LiveRestoreEnabled}}}'])).stdout);
assertFact(info.id==='93e8319e-24b7-4a7d-88f1-60923ad681e0'&&info.os==='linux'&&info.architecture==='x86_64'&&info.version==='29.0.1','ENGINE');
const builder=await docker(['buildx','inspect'],{buildConfig:true});
assertFact(/Driver:\s+docker\s/.test(builder.stdout)&&/BuildKit version:\s+v0\.25\.2/.test(builder.stdout)
  &&(builder.stdout.match(/Status:\s+running/g)??[]).length===1,'BUILDER');
const alias=JSON.parse((await docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}','default'],{buildConfig:true})).stdout);
assertFact(alias===ENDPOINT,'BUILDER_ENDPOINT');
const image=JSON.parse((await docker(['image','inspect','--format','{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"volumes":{{json (index .Config "Volumes")}}}','taki-hindsight-api:local'])).stdout);
assertFact(image.id===base&&image.os==='linux'&&image.architecture==='amd64'&&Object.keys(image.volumes??{}).length===0,'BASE');
assertFact((await docker(['image','ls','--filter','reference='+tag,'--format','{{.ID}}'])).stdout.trim()==='','IMAGE_TAG_COLLISION');
const ids=(await docker(['container','ls','--all','--no-trunc','--format','{{.ID}}'])).stdout.trim().split(/\r?\n/).filter(Boolean);
assertFact(ids.every(id=>/^[0-9a-f]{64}$/.test(id)),'CONTAINER_IDS');
const format='{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"restartPolicy":{{json .HostConfig.RestartPolicy.Name}}}';
const containers=ids.length?(await docker(['container','inspect','--format',format,...ids])).stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line)):[];
save('original-before-containers.json',containers);
save('runtime-prerequisites.json',{recordedAt:new Date().toISOString(),info,builder:builder.stdout,alias,image,baseProbeReused:true,binaryHashes:pins});
capacity();
writeFileSync(STAGE+'/build.started',new Date().toISOString(),{flag:'wx'});
const build=await docker(['buildx','build','--builder','default','--pull=false','--network=none','--load','--progress=plain',
  '--build-arg','NATIVE_IMAGE=taki-hindsight-api:local','--label','taki.c2a.fixture='+TOKEN,
  '--iidfile',STAGE+'/image-id.txt','--tag',tag,'--file',STAGE+'/context/docker/standalone/Dockerfile.c2a-fake',STAGE+'/context'],
  {buildConfig:true,timeout:10*60_000,allowFailure:true});
save('build-command.json',build);
assertFact(build.exitCode===0&&!build.failure,'BUILD_FAILED_NO_RETRY');
const imageId=readFileSync(STAGE+'/image-id.txt','utf8').trim();
assertFact(/^sha256:[0-9a-f]{64}$/.test(imageId)&&imageId!==base,'IMAGE_ID');
const built=JSON.parse((await docker(['image','inspect','--format','{"id":{{json .Id}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"labels":{{json .Config.Labels}},"tags":{{json .RepoTags}}}',tag])).stdout);
assertFact(built.id===imageId&&built.user==='1000:1000'&&built.labels['taki.c2a.fixture']===TOKEN,'BUILT_IMAGE');
save('built-image.json',built);
const compiler='C:/Users/55473/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustc.exe';
const source='H:/TakiAgent/apps/hindsight-host/test-fixtures/fake-key-adapter.rs';
assertFact(hash(compiler)==='6d1c5543ed3a45cfbc1c1332d42d6550d883c14d3c2e323427e631c331cebeeb','COMPILER_PIN');
assertFact(hash(source)==='50f17ba43882725d5e23884ffafd121f03f4e4deec4977a9cea2c25ef76b14be','ADAPTER_SOURCE');
const keys=['SystemRoot','WINDIR','COMSPEC','PATH','PATHEXT','ProgramFiles','ProgramFiles(x86)','ProgramW6432','ProgramData','USERPROFILE','LOCALAPPDATA','APPDATA'];
const compilerEnv=Object.fromEntries(keys.filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
compilerEnv.TEMP=STAGE;compilerEnv.TMP=STAGE;
const version=await run(compiler,['--version'],{env:compilerEnv});
assertFact(version.stdout.trim()==='rustc 1.97.0 (2d8144b78 2026-07-07)','COMPILER_VERSION');
const compiled=await run(compiler,[source,'--edition=2021','-C','debuginfo=0','-o',STAGE+'/fake-key-adapter.exe'],{env:compilerEnv,timeout:60000,allowFailure:true});
save('adapter-build.json',{compiler,version:version.stdout.trim(),compilerSha256:hash(compiler),source:{path:source,sha256:hash(source)},result:compiled,outputSha256:compiled.exitCode===0?hash(STAGE+'/fake-key-adapter.exe'):null});
assertFact(compiled.exitCode===0&&!compiled.failure,'ADAPTER_BUILD');
console.log(JSON.stringify({stage:STAGE,preparation:'PASS',imageId,buildElapsedMs:build.elapsedMs,adapterElapsedMs:compiled.elapsedMs,originalContainers:containers.length}));
