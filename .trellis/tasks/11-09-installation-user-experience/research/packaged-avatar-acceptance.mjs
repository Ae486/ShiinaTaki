/** Isolated packaged avatar acceptance driver. No provider requests or credential output. */
import { mkdirSync, writeFileSync } from 'node:fs';

const output = process.env.AVATAR_ACCEPTANCE_OUTPUT ?? 'G:/taki-native-flow-artifacts-20261110/avatar-acceptance';
const [mode = 'inspect', argument] = process.argv.slice(2);
mkdirSync(output, { recursive: true });
const pages = await (await fetch('http://127.0.0.1:19224/json')).json();
const clients = [];
async function attach(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const evidence = { url: page.url, assets: [], diagnostics: [], characterCalls: [], loadingFailures: [] };
  socket.addEventListener('message', ({ data }) => {
    const item = JSON.parse(data);
    if (item.id) { pending.get(item.id)?.(item); pending.delete(item.id); }
    if (item.method === 'Network.requestWillBeSent' && /asset\.localhost|spike-assets/.test(item.params.request.url)) {
      evidence.assets.push({ event: 'request', url: item.params.request.url, requestId: item.params.requestId });
    }
    if (item.method === 'Network.responseReceived' && /asset\.localhost|spike-assets/.test(item.params.response.url)) {
      evidence.assets.push({ event: 'response', url: item.params.response.url, status: item.params.response.status, mime: item.params.response.mimeType });
    }
    if (item.method === 'Network.loadingFailed') evidence.loadingFailures.push({ requestId: item.params.requestId, error: item.params.errorText, blockedReason: item.params.blockedReason });
    if (item.method === 'Runtime.consoleAPICalled') {
      const values = item.params.args.map(value => value.value ?? value.description);
      if (values.some(value => /costume|Live2D|model|load|error/i.test(String(value)))) evidence.diagnostics.push({ type: item.params.type, values });
    }
    if (item.method === 'Network.webSocketFrameSent') {
      try {
        const frame = JSON.parse(item.params.response.payloadData);
        if (frame.method?.startsWith('character.') || frame.method === 'avatar.report') {
          evidence.characterCalls.push({ method: frame.method, characterId: frame.params?.characterId, costume: frame.params?.costume, fileName: frame.params?.fileName });
        }
      } catch { /* Non-JSON traffic is not acceptance evidence. */ }
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error('CDP timeout: ' + method)); }, 20_000);
    pending.set(requestId, result => { clearTimeout(timer); result.error ? reject(Error(result.error.message)) : resolve(result.result); });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const client = { socket, send, evaluate, evidence };
  clients.push(client);
  await send('Network.enable');
  await send('Runtime.enable');
  return client;
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// Read-only React hook discovery: observations come from the actual mounted scene,
// never from persisted intent or a synthetic renderer. No production debug API is added.
const sceneSnapshotExpression = `(() => {
  const root=document.getElementById('root');
  const key=Object.keys(root??{}).find(name=>name.startsWith('__reactContainer$'));
  const container=key?root[key]:null;
  const queue=[container?.stateNode?.current??container],seen=new Set();
  while(queue.length){
    const fiber=queue.pop();if(!fiber||seen.has(fiber))continue;seen.add(fiber);
    queue.push(fiber.child,fiber.sibling);
    let hook=fiber.memoizedState;
    for(let n=0;hook&&n<100;n++,hook=hook.next){
      const scene=hook.memoizedState;
      if(scene&&typeof scene.reportSnapshot==='function'&&scene.governor){
        const governor=scene.governor,ticker=governor.ticker,snapshot=scene.reportSnapshot();
        return {found:true,...governor.inputs,tickerStarted:ticker.started,maxFPS:ticker.maxFPS,lastTime:ticker.lastTime,
          costumeId:snapshot.costume??null,motionCount:snapshot.motions?.length,expressionCount:snapshot.expressions?.length,
          canvasCount:document.querySelectorAll('canvas').length};
      }
    }
  }
  return {found:false,canvasCount:document.querySelectorAll('canvas').length};
})()`;
writeFileSync(`${output}/scene-snapshot-expression.js`, sceneSnapshotExpression);
async function navigateCostumes(home) {
  await home.evaluate(`(() => { const button=[...document.querySelectorAll('button,a')].find(item=>item.textContent.trim()==='换装'); if(!button)throw Error('Costume navigation absent');button.click();return true;})()`);
  await wait(700);
}
async function selectCostume(home, costume) {
  await home.evaluate(`(() => { const name=${JSON.stringify(costume)}; const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===name);if(!button)throw Error('Costume row absent: '+name);if(button.disabled)throw Error('Costume row disabled');button.click();return true;})()`);
}
async function waitForCostume(pet, costume) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const scene = await pet.evaluate(sceneSnapshotExpression);
    if (scene.costumeId === costume && scene.renderable && scene.tickerStarted) return scene;
    await wait(200);
  }
  throw Error('Costume did not attach: ' + costume);
}
async function renderProof(pet) {
  return pet.evaluate(`(async()=>{
    const canvas=document.querySelector('canvas');
    const gl=canvas?.getContext('webgl2')??canvas?.getContext('webgl');
    if(!gl)throw Error('Live WebGL context absent');
    const result={drawElements:0,drawArrays:0,framebufferBinds:0,textureBinds:0,invalidFramebuffers:0,invalidTextures:0};
    const descriptors=new Map(),originals=new Map();
    const hooks={
      drawElements(){result.drawElements++;},drawArrays(){result.drawArrays++;},
      bindFramebuffer(_target,value){if(value){result.framebufferBinds++;if(!gl.isFramebuffer(value))result.invalidFramebuffers++;}},
      bindTexture(_target,value){if(value){result.textureBinds++;if(!gl.isTexture(value))result.invalidTextures++;}}
    };
    try{
      for(const name of Object.keys(hooks)){
        descriptors.set(name,Object.getOwnPropertyDescriptor(gl,name));originals.set(name,gl[name]);
        gl[name]=function(...args){const output=originals.get(name).apply(this,args);hooks[name](...args);return output;};
      }
      await new Promise(resolve=>setTimeout(resolve,1200));
      return result;
    }finally{
      for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(gl,name,descriptor);else delete gl[name];}
    }
  })()`);
}
try {
  const home = await attach(pages.find(page => page.url === 'http://tauri.localhost/home.html'));
  const pet = await attach(pages.find(page => page.url === 'http://tauri.localhost/pet.html'));
  const scenario = { before: await pet.evaluate(sceneSnapshotExpression) };
  if (['import', 'select', 'cycles', 'failure', 'scope', 'inspect-costumes'].includes(mode)) await navigateCostumes(home);
  if (mode === 'import') {
    const document = await home.send('DOM.getDocument');
    const input = await home.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file][accept=".zip,.zst"]' });
    if (!input.nodeId) throw Error('Actual import input absent');
    await home.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [argument] });
    await wait(4000);
  }
  if (mode === 'select') {
    await selectCostume(home, argument);
    scenario.attached = await waitForCostume(pet, argument);
    await wait(1000);
  }
  if (mode === 'cycles') {
    const names = argument.split(',');
    if(names.length!==2)throw Error('Exactly two costume IDs required');
    scenario.cycles=[];
    for(let cycle=0;cycle<10;cycle++){
      const target=names[cycle%2];
      const started=performance.now();
      await selectCostume(home,target);
      const scene=await waitForCostume(pet,target);
      await wait(300);
      scenario.cycles.push({cycle:cycle+1,target,elapsedMs:performance.now()-started,scene});
      console.log(JSON.stringify({cycle:cycle+1,costume:scene.costumeId,canvasCount:scene.canvasCount}));
    }
  }
  if (mode === 'failure') {
    await pet.send('Network.setCacheDisabled',{cacheDisabled:true});
    await pet.send('Network.setBlockedURLs',{urls:[`*${argument}*model.json`]});
    try {
      await selectCostume(home,argument);
      await wait(3500);
      scenario.afterFailure=await pet.evaluate(sceneSnapshotExpression);
      if(scenario.afterFailure.costumeId!==scenario.before.costumeId||!scenario.afterFailure.renderable||!scenario.afterFailure.tickerStarted)throw Error('Failed replacement did not preserve the attached model');
      scenario.homeFailure=await home.evaluate('document.body.innerText');
    } finally {
      await pet.send('Network.setBlockedURLs',{urls:[]});
      await pet.send('Network.setCacheDisabled',{cacheDisabled:false});
    }
  }
  if (mode === 'reload') { await pet.send('Page.reload', { ignoreCache: true }); await wait(7000); }
  if (mode === 'reload-home') { await home.send('Page.reload', { ignoreCache: true }); await wait(2500); await navigateCostumes(home); }
  if (mode === 'render-proof') {
    scenario.proof=await renderProof(pet);
    scenario.after=await pet.evaluate(sceneSnapshotExpression);
    if(!scenario.proof.drawElements&&!scenario.proof.drawArrays)throw Error('No actual WebGL draws observed');
    if(!scenario.proof.framebufferBinds||!scenario.proof.textureBinds||scenario.proof.invalidFramebuffers||scenario.proof.invalidTextures)throw Error('Live GL resource validation failed');
    if(scenario.after.lastTime<=scenario.before.lastTime)throw Error('Governed ticker did not advance');
  }
  if (mode === 'focus') {
    scenario.window=await pet.evaluate(`(async()=>({documentFocused:document.hasFocus(),hidden:document.hidden,nativeFocused:await window.__TAURI_INTERNALS__.invoke('plugin:window|is_focused',{label:'pet'})}))()`);
    scenario.scene=await pet.evaluate(sceneSnapshotExpression);
    if(scenario.window.nativeFocused!==scenario.scene.focused)throw Error('Native and governor focus differ');
    if(!scenario.scene.renderable||!scenario.scene.tickerStarted||scenario.scene.costumeId!=='native_accept_c')throw Error('Selected costume did not restore');
    if(!scenario.window.nativeFocused&&scenario.scene.maxFPS!==15)throw Error('Unfocused Pet did not use blur tier');
  }
  if (mode === 'scope') {
    scenario.scope=await pet.evaluate(`(async()=>{
      const root=await window.__TAURI_INTERNALS__.invoke('local_characters_root');
      const url=path=>'http://asset.localhost/'+encodeURIComponent(path);
      const selected=await fetch(url(root+'/'+'taki/${argument}/model.json'));
      const workspace=root.slice(0,Math.max(root.lastIndexOf('/'),root.lastIndexOf(String.fromCharCode(92))));
      const sibling=await fetch(url(workspace+'/native-scope-denied.txt'));
      return {root,selectedStatus:selected.status,selectedType:selected.headers.get('content-type'),siblingStatus:sibling.status};
    })()`);
    if(scenario.scope.selectedStatus!==200||scenario.scope.siblingStatus!==403)throw Error('Selected-profile asset scope mismatch');
  }
  const states = [];
  for (const [label, client] of [['home', home], ['pet', pet]]) {
    const state = await client.evaluate(`({url:location.href,text:document.body.innerText,lastCostume:localStorage.getItem('taki.last-costume.taki'),buttons:[...document.querySelectorAll('button')].map(item=>({text:item.textContent.trim(),current:item.getAttribute('aria-current'),disabled:item.disabled})),canvas:[...document.querySelectorAll('canvas')].map(canvas=>({width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight}))})`);
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    const name = `${mode}-${argument?.split(/[\\/]/).at(-1)?.replace(/[^a-zA-Z0-9_.-]/g, '-') ?? 'state'}-${label}`;
    writeFileSync(`${output}/${name}.png`, Buffer.from(screenshot.data, 'base64'));
    const scene = label === 'pet' ? await client.evaluate(sceneSnapshotExpression) : null;
    states.push({ label, ...state, scene, ...client.evidence });
  }
  const basename = `${mode}-${argument?.split(/[\\/]/).at(-1)?.replace(/[^a-zA-Z0-9_.-]/g, '-') ?? 'state'}`;
  writeFileSync(`${output}/${basename}.json`, JSON.stringify({ at: new Date().toISOString(), scenario, states }, null, 2));
  console.log(JSON.stringify(states.map(({ label, text, lastCostume, assets, characterCalls }) => ({ label, text, lastCostume, assets, characterCalls })), null, 2));
} finally {
  for (const client of clients) client.socket.close();
}
