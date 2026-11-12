const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require(path.resolve('node_modules/typescript'));
const root = path.resolve('.trellis/tasks/10-21-agent-delegation-source-context/research/delegation-runtime');
function load(file, imports={}) {
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:(name)=>{
  if(!(name in imports)) throw new Error('unexpected import '+name);
  return imports[name];
 },Map,Set,Promise,Error,AbortController,setTimeout,clearTimeout});
 return module.exports;
}
class CapabilityError extends Error {}
const {HarnessAgentSession}=load(path.join(root,'packages/harness/src/agent/harness-agent-session.ts'),{
 '../errors/harness-capability-unsupported-error':{HarnessCapabilityUnsupportedError:CapabilityError},
 './internal/lifecycle-state-validation':{validateLifecycleStateData:async({state})=>state},
 './internal/run-prompt':{runPrompt:()=>{throw new Error('probe does not run prompts')}},
 '../utils/get-restricted-sandbox-session':{getRestrictedSandboxSession:(s)=>s},
});
(async()=>{
 const rows=[];
 for(const turnState of ['idle','running']) for(const ownsSandboxLifecycle of [false,true]){
  const calls=[];
  const state=(type)=>({type,harnessId:'fake',specificationVersion:'harness-v1',data:{}});
  const session=new HarnessAgentSession({sessionId:'probe',sessionWorkDir:'/probe',toolApproval:undefined,turnState,ownsSandboxLifecycle,
   harness:{harnessId:'fake'},underlyingSession:{isResume:false,doStop:async()=>{calls.push('adapter.stop');return state('resume-session')},doSuspendTurn:async()=>{calls.push('adapter.suspend');return state('continue-turn')}},
   sandboxSession:{stop:async()=>{calls.push('sandbox.stop')}}});
  const resume=await session.stop();
  rows.push({turnState,ownsSandboxLifecycle,calls,hasContinueFrom:!!resume.continueFrom});
 }
 const {createTurnRegistry}=load(path.resolve('packages/core/src/agents/turn-registry.ts'));
 const reg=createTurnRegistry();const parent=reg.begin('character',undefined,'parent-run');const child=reg.begin('character',undefined,'child-run');
 rows.push({registry:'same character overwrite',parentCancelMatched:reg.cancel('character','parent-run'),childCancelMatched:reg.cancel('character','child-run'),parentAborted:parent.signal.aborted,childAborted:child.signal.aborted});
 const result={date:'2026-10-21',node:process.version,probe:'Published harness-session source transpiled with import stubs; fake adapter, no model/network/sandbox execution. Current local TurnRegistry source transpiled unmodified.',rows};
 fs.writeFileSync(path.join(root,'deterministic-probes.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
})();
