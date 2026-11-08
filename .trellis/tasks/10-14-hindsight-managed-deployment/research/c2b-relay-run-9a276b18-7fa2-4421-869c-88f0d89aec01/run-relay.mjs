/** Task-only fixed lifecycle. Imported from already hash-verified in-memory source by launch.mjs. */
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const TOKEN = '9a276b18-7fa2-4421-869c-88f0d89aec01';
const IMAGE = 'sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db';
const ENGINE = '93e8319e-24b7-4a7d-88f1-60923ad681e0';
const ENTRY = '/app/api/.venv/bin/python';
const NAME = `taki-c2b-relay-${TOKEN}`;
const MARKER = `taki-c2b-relay:${TOKEN}`;
const IMAGE_FORMAT = '{"Id":{{json .Id}},"Os":{{json .Os}},"Architecture":{{json .Architecture}},"Volumes":{{json (index .Config "Volumes")}}}';
const CONTAINER_FORMAT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Path":{{json .Path}},"Args":{{json .Args}},'
  + '"User":{{json .Config.User}},"Labels":{{json .Config.Labels}},"Tty":{{json .Config.Tty}},"OpenStdin":{{json .Config.OpenStdin}},'
  + '"NetworkMode":{{json .HostConfig.NetworkMode}},"Networks":{{json .NetworkSettings.Networks}},"PortBindings":{{json .HostConfig.PortBindings}},'
  + '"Ports":{{json .NetworkSettings.Ports}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Mounts":{{json .Mounts}},'
  + '"Memory":{{json .HostConfig.Memory}},"NanoCpus":{{json .HostConfig.NanoCpus}},"PidsLimit":{{json .HostConfig.PidsLimit}},'
  + '"Privileged":{{json .HostConfig.Privileged}},"CapAdd":{{json .HostConfig.CapAdd}},"CapDrop":{{json .HostConfig.CapDrop}},'
  + '"SecurityOpt":{{json .HostConfig.SecurityOpt}},"LogConfig":{{json .HostConfig.LogConfig}},"RestartPolicy":{{json .HostConfig.RestartPolicy}},'
  + '"Running":{{json .State.Running}},"Status":{{json .State.Status}},"Pid":{{json .State.Pid}},'
  + '"StartedAt":{{json .State.StartedAt}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}}}';

const requireFact = (condition, code) => { if (!condition) throw new Error(code); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const empty = (value) => value === null || (typeof value === 'object' && Object.keys(value).length === 0);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const shortIdentity = (identity) => ({ pid: identity.pid, startTicks: identity.startTicks });
const errorCode = (error) => /^[A-Z0-9_]+$/.test(error.message ?? '') ? error.message : (error.code ?? error.name ?? 'ERROR');

function inspectProjection(record, ok) {
  requireFact(ok(record) && record.stderr === '' && record.stdout.trim().split('\n').length === 1, 'INSPECT_FAILED');
  return JSON.parse(record.stdout);
}

function absence(record, ref) {
  return record.code === 1 && record.closeObserved && !record.timedOut && !record.overflow && !record.spawnError
    && !record.persistenceError && record.streamErrors.length === 0
    && record.stdout.trim() === ''
    && new RegExp(`^Error(?: response from daemon)?: No such (?:container|object): ${ref}$`).test(record.stderr.trim());
}

function checkContainer(state, id) {
  const exact = { Id: id, Name: `/${NAME}`, Image: IMAGE, Path: ENTRY, Args: ['-I', '-B', '-'], User: '1000:1000',
    Tty: false, OpenStdin: true, NetworkMode: 'none', ReadonlyRootfs: true, Mounts: [], Memory: 268435456,
    NanoCpus: 1000000000, PidsLimit: 16, Privileged: false, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges=true'] };
  for (const [key, value] of Object.entries(exact)) requireFact(same(state[key], value), `CONTAINER_${key.toUpperCase()}_MISMATCH`);
  requireFact(state.Labels?.['taki.c2b.relay'] === TOKEN && state.Labels?.['taki.c2b.role'] === 'loopback-transport-diagnostic', 'LABEL_MISMATCH');
  requireFact(empty(state.CapAdd) && empty(state.PortBindings), 'ADDED_PRIVILEGE_OR_PUBLICATION');
  requireFact(Object.values(state.Ports ?? {}).every((value) => value === null), 'LIVE_PUBLICATION');
  requireFact(Object.keys(state.Networks ?? {}).every((key) => key === 'none'), 'ADDED_NETWORK');
  for (const network of Object.values(state.Networks ?? {})) {
    requireFact(!network.IPAddress && !network.GlobalIPv6Address && !network.Gateway && !network.IPv6Gateway, 'NETWORK_ADDRESS');
  }
  requireFact(state.LogConfig?.Type === 'none' && empty(state.LogConfig.Config), 'LOG_SETTING');
  requireFact(state.RestartPolicy?.Name === 'no' && state.RestartPolicy.MaximumRetryCount === 0, 'RESTART_SETTING');
  requireFact(state.OOMKilled === false, 'CONTAINER_OOM');
}

function checkReadiness(event) {
  requireFact(event.token === TOKEN && event.process?.valid === true && event.network?.onlyLoopback === true, 'ISOLATION_FACTS');
  const expected = [
    { family: 2, target: ['1.1.1.1', 443] }, { family: 2, target: ['169.254.1.1', 80] },
    { family: 10, target: ['2606:4700:4700::1111', 443, 0, 0] },
    { family: 10, target: ['fe80::1', 80, 0, event.network.interfaces[0][0]] },
  ];
  requireFact(Array.isArray(event.probes) && event.probes.length === 4, 'PROBE_COUNT');
  event.probes.forEach((probe, index) => {
    const errorExpected = probe.phase === 'socket' ? ['EAFNOSUPPORT', 'EPROTONOSUPPORT'].includes(probe.code)
      : probe.phase === 'connect' && ['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL'].includes(probe.code);
    requireFact(probe.family === expected[index].family && same(probe.target, expected[index].target)
      && probe.outcome === 'error' && errorExpected && probe.expectedRefusal === true, 'ISOLATION_PROBE_FAILED');
  });
  requireFact(event.process.identity.pid === 1 && /^\d+$/.test(event.process.identity.startTicks), 'SERVER_IDENTITY');
}

function checkStreams(host, result, ok) {
  requireFact(host.accepted === 2 && host.streams.length === 2 && host.failures.length === 0, 'HOST_CONNECTIONS');
  const identities = [];
  host.streams.forEach((stream, index) => {
    const ready = stream.events.events.filter((event) => event.event === 'ready');
    requireFact(!stream.events.error && stream.events.pending === '' && ready.length === 1, 'RELAY_EVENTS');
    requireFact(ready[0].marker === MARKER && same(ready[0].target, ['127.0.0.1', 8000])
      && Number.isSafeInteger(ready[0].identity.pid) && ready[0].identity.pid > 1 && /^\d+$/.test(ready[0].identity.startTicks), 'RELAY_IDENTITY');
    identities.push(ready[0].identity);
    const record = stream.command.record;
    requireFact(record.closeObserved && !record.timedOut && !record.overflow && !record.spawnError, 'RELAY_EXIT_UNKNOWN');
    if (index === 0) {
      const complete = stream.events.events.find((event) => event.event === 'complete');
      requireFact(ok(record) && stream.errors.length === 0 && stream.clientEnd && !stream.aborted && stream.clientClosed
        && stream.toChild === 32768 && stream.toClient === 49152 && complete?.stdinEof && complete.targetEof && complete.targetHalfClosed
        && complete.received.stdin === 32768 && complete.received.target === 49152
        && complete.sent.target === 32768 && complete.sent.stdout === 49152
        && complete.readChunks.stdin.length > 1 && complete.readChunks.target.length > 1
        && complete.digests.stdin === result.first.requestSha256 && complete.digests.target === result.first.receivedSha256, 'HALF_CLOSE_RELAY');
    } else {
      requireFact(stream.aborted && stream.clientClosed && !stream.clientEnd && stream.toChild === 1024 && stream.toClient === 512, 'ABORT_NOT_OBSERVED');
      requireFact(stream.errors.every((error) => error === 'client:ECONNRESET'
        || (error === 'RELAY_CLI_UNSUCCESSFUL' && record.kills.some((kill) => kill.reason === 'client-abort'))), 'ABORT_RELAY_ERROR');
      requireFact(!record.persistenceError && record.streamErrors.length === 0
        && (ok(record) || record.kills.some((kill) => kill.reason === 'client-abort')), 'ABORT_TERMINATION_UNKNOWN');
    }
  });
  requireFact(new Set(identities.map((identity) => `${identity.pid}:${identity.startTicks}`)).size === 2, 'DUPLICATE_RELAY');
  return identities;
}

export async function run({ here, files, release, modules }) {
  const { DockerCommands, commandOk } = modules.commands;
  const { HostTransport, JsonEvents, bounded, binaryClient, provePortFree, proveExclusiveListener } = modules.transport;
  const { EvidenceStore } = modules.evidence;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const overallDeadline = started + 60000;
  const runtimeDeadline = started + 40000;
  const stageRoot = resolve('G:/TakiAgent-c2b-native-api');
  const stage = join(stageRoot, `relay-${TOKEN}`);
  const archive = resolve(here, `../c2b-relay-run-${TOKEN}`);
  const settings = { stageRoot, stage, archive, token: TOKEN };
  const store = new EvidenceStore(settings, files);
  const result = {
    schema: 'c2b-relay-run-v1', token: TOKEN, deploymentReady: false,
    scope: 'Transport diagnostic only; no API, PostgreSQL, authentication, receipt, setup, model, or installed-deployment acceptance',
    release, node: process.version, nodeExecutable: process.execPath, hostPid: process.pid,
    transportPassed: false, failure: null, inputs: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])),
    first: null, second: null, ready: null, fixtureEvents: [], streams: [], inspections: [],
    cleanup: { proven: false, failures: [], container: 'not-created', port: null, cliChildrenClosed: false },
    timing: { overallBoundMs: 60000, runtimeBoundMs: 40000, readinessBoundMs: 10000, cleanupReserveMs: 20000, startedAt },
  };
  let commands;
  let host;
  let attach;
  let id;
  let originalStart;
  let createAttempted = false;
  let createProven = false;
  let observerCount = 0;
  const fixture = new JsonEvents('c2b-relay-fixture-v1');
  const engine = async () => {
    const record = await commands.call(['info', '--format',
      '{"Id":{{json .ID}},"ServerVersion":{{json .ServerVersion}},"OSType":{{json .OSType}}}'], { timeout: 5000 });
    const observed = inspectProjection(record, commandOk);
    requireFact(observed.Id === ENGINE && observed.ServerVersion === '29.0.1' && observed.OSType === 'linux', 'ENGINE_MISMATCH');
    result.engine = observed;
  };
  const inspect = async (ref) => commands.call(['container', 'inspect', ref, '--format', CONTAINER_FORMAT], { timeout: 5000 });
  const ownedState = async () => {
    requireFact(id && createProven, 'ORIGINAL_CONTAINER_UNPROVEN');
    await engine();
    const state = inspectProjection(await inspect(id), commandOk);
    checkContainer(state, id);
    if (originalStart) requireFact(state.StartedAt === originalStart, 'ORIGINAL_START_CHANGED');
    result.inspections.push(state);
    return state;
  };
  try {
    requireFact(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) === 24, 'PLATFORM');
    store.create();
    commands = new DockerCommands({ stage, config: join(stage, 'client-config'), systemRoot: process.env.SystemRoot,
      docker: 'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
      dockerSha256: '0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d',
      endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine', runtimeDeadline,
      persist: (records) => store.write('commands.json', records) });
    host = new HostTransport({ startRelay: (onStderr) => {
      requireFact(id && createProven, 'RELAY_CONTAINER_UNKNOWN');
      requireFact(host.streams.length < 2, 'RELAY_CHILD_BOUND');
      return commands.start(['exec', '--interactive', '--user', '1000:1000', id, ENTRY, '-I', '-B', '-c',
        files['stream-relay.py'].toString('utf8'), MARKER], { streaming: true, binary: true, maxStdout: 65536, onStderr });
    } });
    result.hostListener = await bounded(host.listen(), Math.min(started + 10000, commands.deadline), 'HOST_LISTEN_DEADLINE');
    requireFact(result.hostListener?.address === '127.0.0.1' && result.hostListener.port === 58118, 'HOST_BINDING');
    result.listenerExclusivity = await bounded(proveExclusiveListener(), Math.min(started + 10000, commands.deadline), 'EXCLUSIVE_BIND_DEADLINE');
    requireFact(result.listenerExclusivity.refused, 'HOST_NOT_EXCLUSIVE');
    await engine();
    const image = inspectProjection(await commands.call(['image', 'inspect', IMAGE, '--format', IMAGE_FORMAT], { timeout: 5000 }), commandOk);
    result.image = image;
    requireFact(image.Id === IMAGE && image.Os === 'linux' && image.Architecture === 'amd64' && empty(image.Volumes), 'IMAGE_MISMATCH');
    requireFact(absence(await inspect(NAME), NAME), 'CONTAINER_NAME_COLLISION');
    createAttempted = true;
    const created = await commands.call(['create', '--name', NAME, '--label', `taki.c2b.relay=${TOKEN}`,
      '--label', 'taki.c2b.role=loopback-transport-diagnostic', '--pull', 'never', '--network', 'none', '--read-only',
      '--user', '1000:1000', '--interactive', '--log-driver', 'none', '--memory', '256m', '--cpus', '1', '--pids-limit', '16',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--entrypoint', ENTRY, IMAGE, '-I', '-B', '-'], { timeout: 5000 });
    requireFact(commandOk(created) && /^[0-9a-f]{64}$/.test(created.stdout.trim()), 'CREATE_REPLY_UNKNOWN');
    id = created.stdout.trim();
    result.containerId = id;
    const before = inspectProjection(await inspect(id), commandOk);
    checkContainer(before, id);
    requireFact(before.Running === false && before.Status === 'created', 'BEFORE_START_STATE');
    createProven = true;
    result.inspections.push(before);
    const readyDeadline = Math.min(commands.deadline, performance.now() + 10000);
    attach = commands.start(['start', '--attach', '--interactive', id], {
      input: files['fixture-server.py'], onStdout: (chunk) => fixture.push(chunk), maxStdout: 32768,
    });
    const ready = await fixture.wait('ready', readyDeadline, attach);
    result.ready = ready;
    checkReadiness(ready);
    const running = await ownedState();
    requireFact(running.Running === true && running.Status === 'running' && running.Pid > 0, 'SERVER_NOT_RUNNING');
    originalStart = running.StartedAt;
    host.ready = true;
    result.first = await binaryClient({ token: TOKEN, abort: false, deadline: Math.min(commands.deadline, performance.now() + 10000) });
    requireFact(result.first.valid, 'FIRST_BINARY_CLIENT');
    requireFact(host.streams.length === 1, 'FIRST_RELAY_MISSING');
    await bounded(Promise.all([host.streams[0].command.done, host.streams[0].closed]),
      Math.min(commands.deadline, performance.now() + 5000), 'FIRST_RELAY_CLOSE');
    requireFact((await ownedState()).Running === true, 'ORIGINAL_SERVER_LOST');
    result.second = await binaryClient({ token: TOKEN, abort: true, deadline: Math.min(commands.deadline, performance.now() + 10000) });
    requireFact(result.second.valid && host.streams.length === 2, 'SECOND_BINARY_CLIENT');
    await bounded(Promise.all([host.streams[1].command.done, host.streams[1].closed]),
      Math.min(commands.deadline, performance.now() + 5000), 'ABORT_RELAY_CLOSE');
    const completed = await fixture.wait('complete', commands.deadline, attach);
    requireFact(completed.listenerClosed && completed.cases.length === 2
      && completed.cases[0].requestEof && completed.cases[0].responseHalfClosed
      && completed.cases[0].requestSha256 === result.first.requestSha256
      && completed.cases[0].responseSha256 === result.first.receivedSha256
      && completed.cases[0].responseWrites.length > 1 && completed.cases[1].cancelled
      && ['eof', 'ECONNRESET'].includes(completed.cases[1].reason)
      && completed.cases[1].requestSha256 === result.second.requestSha256
      && completed.cases[1].ackSha256 === result.second.receivedSha256, 'SERVER_TRANSFER_FACTS');
    const relayIdentities = checkStreams(host, result, commandOk);
    await bounded(host.close(), commands.deadline, 'HOST_CLOSE_RUNTIME_DEADLINE');
    requireFact((await ownedState()).Running === true, 'OBSERVER_CONTAINER_LOST');
    requireFact(observerCount++ === 0, 'OBSERVER_BOUND');
    const observation = await commands.call(['exec', '--interactive', '--user', '1000:1000', id, ENTRY, '-I', '-B', '-c',
      files['observe-reaping.py'].toString('utf8')], {
      input: Buffer.from(JSON.stringify({ server: shortIdentity(ready.process.identity), relays: relayIdentities.map(shortIdentity) })),
      timeout: 6500,
    });
    const reap = inspectProjection(observation, commandOk);
    result.reaping = reap;
    requireFact(reap.schema === 'c2b-relay-reaping-v1' && reap.event === 'collected' && reap.after?.absent === true
      && reap.originalServerUnchanged === true && reap.deploymentReady === false, 'REAP_UNPROVEN');
    requireFact(fixture.error === null && !fixture.events.some((event) => event.event === 'failed'), 'FIXTURE_FAILED');
    result.transportPassed = true;
  } catch (error) {
    result.failure = errorCode(error);
  } finally {
    result.timing.runtimeElapsedMs = performance.now() - started;
    const cleanupStart = performance.now();
    const cleanupDeadline = overallDeadline;
    commands?.cleanupDeadline(cleanupDeadline);
    const attempt = async (label, action) => {
      try { await action(); } catch (error) { result.cleanup.failures.push({ label, code: errorCode(error) }); }
    };
    await attempt('host-close', async () => { if (host) await bounded(host.close(), cleanupDeadline, 'HOST_CLOSE_TIMEOUT'); });
    await attempt('relay-children', async () => {
      for (const stream of host?.streams ?? []) stream.command.terminate('owned-shutdown');
      await bounded(Promise.all((host?.streams ?? []).map((stream) => stream.command.done)), cleanupDeadline, 'RELAY_CLEANUP_TIMEOUT');
    });
    await attempt('original-container', async () => {
      if (!createAttempted) return;
      if (!id || !createProven) {
        // A lost create reply cannot turn the frozen name into mutation authority.
        result.cleanup.container = 'unknown-create-retained';
        result.unknownCreateObservation = await inspect(id ?? NAME);
        throw new Error('CREATE_OWNERSHIP_UNKNOWN');
      }
      let state = await ownedState();
      if (state.Running) {
        const stopped = await commands.call(['stop', '--time', '3', id], { timeout: 6000 });
        requireFact(commandOk(stopped), 'STOP_FAILED');
        state = await ownedState();
      }
      result.stoppedState = state;
      requireFact(state.Running === false && ['created', 'exited'].includes(state.Status), 'STOP_UNPROVEN');
      if (attach) {
        const attached = await bounded(attach.done, cleanupDeadline, 'ATTACH_CLOSE_TIMEOUT');
        const stoppedEvents = fixture.events.filter((event) => event.event === 'stopped');
        if (!commandOk(attached) || state.ExitCode !== 0 || fixture.error !== null || fixture.pending !== ''
          || stoppedEvents.length !== 1 || !result.ready
          || !same(shortIdentity(stoppedEvents[0].identity), shortIdentity(result.ready.process.identity))) {
          result.cleanup.failures.push({ label: 'fixture-stop', code: 'FIXTURE_STOP_UNSUCCESSFUL' });
        }
      }
      requireFact(commandOk(await commands.call(['rm', id], { timeout: 5000 })), 'REMOVE_FAILED');
      requireFact(absence(await inspect(id), id) && absence(await inspect(NAME), NAME), 'CONTAINER_ABSENCE_UNPROVEN');
      result.cleanup.container = 'original-stopped-removed-and-absent';
    });
    await attempt('cli-children', async () => {
      result.cleanup.cliChildrenClosed = commands ? await commands.stopRemaining() : true;
      requireFact(result.cleanup.cliChildrenClosed, 'CLI_CLOSE_UNPROVEN');
    });
    await attempt('host-port', async () => {
      if (!result.hostListener) { result.cleanup.port = { state: 'not-acquired', free: null }; return; }
      result.cleanup.port = await bounded(provePortFree(), cleanupDeadline, 'PORT_CHECK_TIMEOUT');
      requireFact(result.cleanup.port.free, 'HOST_PORT_NOT_RELEASED');
    });
    result.fixtureEvents = fixture.events;
    result.streams = (host?.streams ?? []).map((stream) => ({
      index: stream.index, toChild: stream.toChild, toClient: stream.toClient,
      clientEnd: stream.clientEnd, clientClosed: stream.clientClosed, aborted: stream.aborted,
      errors: stream.errors, backpressure: stream.backpressure, events: stream.events.events,
      eventError: stream.events.error, pendingEventBytes: stream.events.pending.length, commandIndex: stream.command.record.index,
    }));
    result.hostFailures = host?.failures ?? [];
    result.acceptedConnections = host?.accepted ?? 0;
    result.observerExecutions = observerCount;
    result.timing.cleanupElapsedMs = performance.now() - cleanupStart;
    result.timing.beforeArchiveElapsedMs = performance.now() - started;
    result.cleanup.proven = result.cleanup.failures.length === 0 && performance.now() < overallDeadline;
    result.transportPassed &&= result.timing.runtimeElapsedMs <= 40000;
  }
  let disposition;
  if (store.owned) {
    try { disposition = store.archive(result, overallDeadline, started); }
    catch (error) {
      result.archiveFailure = errorCode(error);
      try { store.write('result.json', result); } catch (writeError) { result.finalWriteFailure = errorCode(writeError); }
    }
  }
  console.log(JSON.stringify(disposition ?? { token: TOKEN, verdict: 'FAIL', deploymentReady: false,
    stageOwned: store.owned, archiveCreated: store.archiveCreated, stage, archive, failure: result.failure,
    archiveFailure: result.archiveFailure ?? null, cleanup: result.cleanup }));
  process.exitCode = disposition?.verdict === 'PASS' ? 0 : 1;
}
