import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { STAGE, TOKEN, docker, assertFact } from './command-runner.mjs';
const evidence=JSON.parse(readFileSync(STAGE+'/persistence.json','utf8'));
const result={recordedAt:new Date().toISOString(),caseId:TOKEN,retainedHarnessOutcome:evidence.casePassed,scope:'Read-only owned event recovery using Engine time',checks:{},failure:null};
const counter=rows=>rows.reduce((map,row)=>(map[row.Action]=(map[row.Action]??0)+1,map),{});
async function execRead(id){
  assertFact(/^[0-9a-f]{64}$/.test(id),'EXEC_ID');
  return new Promise((resolve,reject)=>{
    const call=request({socketPath:String.raw`\\.\pipe\dockerDesktopLinuxEngine`,path:'/exec/'+id+'/json',method:'GET',signal:AbortSignal.timeout(5000)},response=>{
      const chunks=[];let bytes=0;
      response.on('data',part=>{bytes+=part.length;if(bytes>65536)call.destroy(new Error('EXEC_OUTPUT_LIMIT'));else chunks.push(part);});
      response.on('error',reject);
      response.on('end',()=>resolve({httpStatus:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    call.on('error',reject);call.end();
  });
}
try {
  const localBefore=Date.now();
  const clock=JSON.parse((await docker(['info','--format','{"id":{{json .ID}},"systemTime":{{json .SystemTime}}}'],{cleanup:true})).stdout);
  const localAfter=Date.now();
  assertFact(clock.id==='93e8319e-24b7-4a7d-88f1-60923ad681e0'&&Number.isFinite(Date.parse(clock.systemTime)),'ENGINE_CLOCK');
  const original=evidence.cleanupOriginal;
  assertFact(original&&/^[0-9a-f]{64}$/.test(original.containerId),'OWNED_CONTAINER');
  const previous=[...evidence.beforeRestartEngineEvents.container,...evidence.beforeRestartEngineEvents.volume];
  assertFact(previous.length>0&&previous.every(row=>Number.isSafeInteger(row.time)),'ENGINE_EVENT_TIMES');
  const since=new Date(Math.min(...previous.map(row=>row.time*1000))-1000).toISOString();
  const until=clock.systemTime;
  assertFact(Date.parse(until)>Date.parse(evidence.finalStop.container.FinishedAt)&&Date.parse(until)-Date.parse(since)<30*60_000,'ENGINE_WINDOW');
  result.clock={windowsBefore:new Date(localBefore).toISOString(),windowsAfter:new Date(localAfter).toISOString(),engineSystemTime:until,engineMinusWindowsIntervalMs:[Date.parse(until)-localAfter,Date.parse(until)-localBefore]};
  result.window={since,until,source:'prior owned Engine event timestamps and current Engine SystemTime',originalUntil:evidence.commands.findLast(command=>command.argv[0]==='events')?.argv[4],finalContainerFinishedAt:evidence.finalStop.container.FinishedAt};
  result.owned=original;
  const raw=(await docker(['events','--since',since,'--until',until,'--filter','container='+original.containerId,'--format','{{json .}}'],{cleanup:true})).stdout;
  const rows=raw.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  assertFact(rows.length<=256&&rows.every(row=>row.Type==='container'&&row.Actor?.ID===original.containerId),'EVENT_SCOPE');
  result.containerEvents=rows;result.containerEventCounts=counter(rows);
  const rawVolume=(await docker(['events','--since',since,'--until',until,'--filter','type=volume','--filter','volume='+original.volume,'--format','{{json .}}'],{cleanup:true})).stdout;
  const volumes=rawVolume.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  assertFact(volumes.length<=64&&volumes.every(row=>row.Type==='volume'&&row.Actor?.ID===original.volume),'VOLUME_EVENT_SCOPE');
  result.volumeEvents=volumes;result.volumeEventCounts=counter(volumes);
  const created=rows.filter(row=>row.Action.startsWith('exec_create:'));
  const exited=rows.filter(row=>row.Action==='exec_die');
  result.execLifecycle=created.map(row=>({id:row.Actor.Attributes.execID,command:row.Action.slice('exec_create: '.length),exitCodes:exited.filter(done=>done.Actor.Attributes.execID===row.Actor.Attributes.execID).map(done=>done.Actor.Attributes.exitCode)}));
  const known=new Map(evidence.execEvidence.map(meta=>[meta.ID,meta]));
  result.retainedExecMetadata=evidence.execEvidence;
  result.additionalExecMetadata=[];
  const missing=result.execLifecycle.filter(item=>!known.has(item.id));
  result.execMetadataUnavailableIds=missing.map(item=>item.id);
  for(const item of missing){
    const read=await execRead(item.id);
    if(read.httpStatus!==200){result.execMetadataRead={id:item.id,httpStatus:read.httpStatus,body:read.body};break;}
    const meta=JSON.parse(read.body);assertFact(meta.ID===item.id&&meta.ContainerID===original.containerId,'EXEC_RESOURCE');
    result.additionalExecMetadata.push(meta);
    result.execMetadataUnavailableIds=result.execMetadataUnavailableIds.filter(id=>id!==item.id);
  }
  const count=result.containerEventCounts;
  result.checks.sameContainerOneCreateTwoStartsTwoStops=count.create===1&&count.start===2&&count.stop===2&&count.die===2;
  result.checks.exactContainerRemoved=count.destroy===1;
  result.checks.oneOriginalVolumeCreated=result.volumeEventCounts.create===1;
  result.checks.twoOriginalVolumeMounts=result.volumeEventCounts.mount===2&&result.volumeEventCounts.unmount===2;
  result.checks.exactVolumeRemoved=result.volumeEventCounts.destroy===1;
  result.checks.twoSubmitters=result.execLifecycle.filter(item=>item.command==='/app/api/.venv/bin/python -I -B -m managed_bootstrap.submitter').length===2;
  result.checks.allExecsCompletedOnce=result.execLifecycle.every(item=>item.exitCodes.length===1);
  result.checks.eventsAvailable=rows.length>0&&volumes.length>0;
  result.finalNoTtyCoverage={retained:evidence.execEvidence.length,additional:result.additionalExecMetadata.length,total:created.length,missing:result.execMetadataUnavailableIds.length};
} catch(error){result.failure=error.message;process.exitCode=1;}
writeFileSync(STAGE+'/root-event-recovery.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checks:result.checks,clock:result.clock,containerCounts:result.containerEventCounts,volumeCounts:result.volumeEventCounts,noTtyCoverage:result.finalNoTtyCoverage,failure:result.failure}));
