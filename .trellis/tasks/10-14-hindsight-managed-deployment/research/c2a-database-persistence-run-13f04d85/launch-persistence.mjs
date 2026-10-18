import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { STAGE,run,assertFact } from './command-runner.mjs';
const launcher='H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-database/run-persistence.ts';
assertFact(createHash('sha256').update(readFileSync(launcher)).digest('hex')==='951de1587a37a0dba96fbf76bf029943128c9e80fc7ea1aa5dfe888fff470d25','LAUNCHER_PIN');
const result=await run('C:/Program Files/nodejs/node.exe',[launcher,'--execute-approved-persistence'],{
  timeout:20*60_000,allowFailure:true,
  env:{SystemRoot:process.env.SystemRoot,TEMP:STAGE,TMP:STAGE,WS_NO_BUFFER_UTIL:'1',WS_NO_UTF_8_VALIDATE:'1'}
});
writeFileSync(STAGE+'/launcher-command.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({exitCode:result.exitCode,failure:result.failure,elapsedMs:result.elapsedMs,stdout:result.stdout,stderr:result.stderr,evidence:STAGE+'/persistence.json'}));
process.exitCode=result.exitCode===0&&!result.failure?0:1;
