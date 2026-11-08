/** Root-only, one-shot metadata collector. This module executes effects after source validation. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const TOKEN = '0ab89a2a-ccac-4350-a4ea-ed90ed7a3e6d';
const HERE = fileURLToPath(new URL('./', import.meta.url));
const NAME = `taki-c2b-dependencies-${TOKEN}`;
const ENTRY = '/app/api/.venv/bin/python';
const IMAGE = 'sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db';
const ENGINE = '93e8319e-24b7-4a7d-88f1-60923ad681e0';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireFact = (condition, code) => { if (!condition) throw new Error(code); };
const empty = (value) => value == null || Object.keys(value).length === 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const codeOf = (error) => /^[A-Z0-9_]{1,80}$/.test(error.message ?? '') ? error.message : 'COLLECTION_ERROR';
const FORMAT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Path":{{json .Path}},"Args":{{json .Args}},'
  + '"User":{{json .Config.User}},"Labels":{{json .Config.Labels}},"Tty":{{json .Config.Tty}},"OpenStdin":{{json .Config.OpenStdin}},'
  + '"NetworkMode":{{json .HostConfig.NetworkMode}},"Networks":{{json .NetworkSettings.Networks}},"PortBindings":{{json .HostConfig.PortBindings}},'
  + '"Ports":{{json .NetworkSettings.Ports}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Mounts":{{json .Mounts}},'
  + '"Memory":{{json .HostConfig.Memory}},"NanoCpus":{{json .HostConfig.NanoCpus}},"PidsLimit":{{json .HostConfig.PidsLimit}},'
  + '"Privileged":{{json .HostConfig.Privileged}},"CapAdd":{{json .HostConfig.CapAdd}},"CapDrop":{{json .HostConfig.CapDrop}},'
  + '"SecurityOpt":{{json .HostConfig.SecurityOpt}},"LogConfig":{{json .HostConfig.LogConfig}},"RestartPolicy":{{json .HostConfig.RestartPolicy}},'
  + '"Running":{{json .State.Running}},"Status":{{json .State.Status}},"StartedAt":{{json .State.StartedAt}},'
  + '"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}}}';

function validateContainer(value, id) {
  const expected = { Id: id, Name: `/${NAME}`, Image: IMAGE, Path: ENTRY, Args: ['-I', '-B', '-S', '-'],
    User: '1000:1000', Tty: false, OpenStdin: true, NetworkMode: 'none', ReadonlyRootfs: true, Mounts: [],
    Memory: 268435456, NanoCpus: 1000000000, PidsLimit: 16, Privileged: false, CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges=true'], OOMKilled: false };
  for (const [key, item] of Object.entries(expected)) requireFact(same(value[key], item), 'CONTAINER_MISMATCH');
  requireFact(value.Labels?.['taki.c2b.dependencies'] === TOKEN && value.Labels?.['taki.c2b.role'] === 'dependency-inventory', 'LABEL_MISMATCH');
  requireFact(empty(value.CapAdd) && empty(value.PortBindings) && Object.values(value.Ports ?? {}).every((item) => item === null), 'PUBLICATION_OR_PRIVILEGE');
  requireFact(Object.keys(value.Networks ?? {}).every((key) => key === 'none'), 'NETWORK_MISMATCH');
  for (const item of Object.values(value.Networks ?? {})) requireFact(!item.IPAddress && !item.GlobalIPv6Address && !item.Gateway && !item.IPv6Gateway, 'NETWORK_ADDRESS');
  requireFact(value.LogConfig?.Type === 'none' && empty(value.LogConfig.Config)
    && value.RestartPolicy?.Name === 'no' && value.RestartPolicy.MaximumRetryCount === 0, 'LIFECYCLE_SETTINGS');
}

async function run(release, files, modules) {
  const started = performance.now();
  const totalDeadline = started + 60000;
  const stageRoot = resolve('G:/TakiAgent-c2b-native-api');
  const stage = join(stageRoot, `dependencies-${TOKEN}`);
  const archive = resolve(HERE, `../c2b-dependencies-run-${TOKEN}`);
  requireFact(resolve(release.archive) === archive, 'ARCHIVE_BINDING');
  const store = new modules.evidence.EvidenceStore({ stageRoot, stage, archive, token: TOKEN }, files);
  const result = { schema: 'c2b-dependency-run-v1', token: TOKEN, scope: 'Complete metadata collection only; compatibility, application image and API remain unaccepted',
    deploymentReady: false, inventoryComplete: false, inventory: null, release, inputs: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, hash(bytes)])),
    failure: null, inspections: [], cleanup: { proven: false, failures: [], container: 'not-created', cliChildrenClosed: false },
    timing: { startedAt: new Date().toISOString(), totalBoundMs: 60000, workBoundMs: 40000 } };
  let commands; let id; let createAttempted = false; let owned = false;
  const ok = modules.commands.commandOk;
  const projection = (record) => {
    requireFact(ok(record) && record.stderr === '' && record.stdout.trim().split('\n').length === 1, 'PROJECTION_FAILED');
    return JSON.parse(record.stdout);
  };
  const inspect = (ref) => commands.call(['container', 'inspect', ref, '--format', FORMAT], { timeout: 5000 });
  const absent = (record, ref) => record.code === 1 && record.closeObserved && !record.timedOut && !record.overflow
    && !record.spawnError && !record.persistenceError && record.streamErrors.length === 0 && record.stdout.trim() === ''
    && new RegExp(`^Error(?: response from daemon)?: No such (?:container|object): ${ref}$`).test(record.stderr.trim());
  const engine = async () => {
    const value = projection(await commands.call(['info', '--format', '{"id":{{json .ID}},"version":{{json .ServerVersion}},"os":{{json .OSType}}}'], { timeout: 5000 }));
    requireFact(value.id === ENGINE && value.version === '29.0.1' && value.os === 'linux', 'ENGINE_MISMATCH');
    result.engine = value;
  };
  const original = async () => {
    requireFact(owned && id, 'OWNERSHIP_UNKNOWN');
    await engine();
    const value = projection(await inspect(id));
    validateContainer(value, id); result.inspections.push(value); return value;
  };
  try {
    store.create();
    commands = new modules.commands.DockerCommands({ stage, config: join(stage, 'client-config'), systemRoot: process.env.SystemRoot,
      docker: release.docker.path, dockerSha256: release.docker.sha256, endpoint: release.engine.endpoint,
      runtimeDeadline: started + 40000, persist: (records) => store.write('commands.json', records) });
    await engine();
    const image = projection(await commands.call(['image', 'inspect', IMAGE, '--format',
      '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"volumes":{{json (index .Config "Volumes")}}}'], { timeout: 5000 }));
    requireFact(image.id === IMAGE && image.os === 'linux' && image.architecture === 'amd64' && empty(image.volumes), 'IMAGE_MISMATCH');
    result.image = image;
    requireFact(absent(await inspect(NAME), NAME), 'NAME_NOT_ABSENT');
    createAttempted = true;
    const created = await commands.call(['create', '--name', NAME, '--label', `taki.c2b.dependencies=${TOKEN}`,
      '--label', 'taki.c2b.role=dependency-inventory', '--pull', 'never', '--network', 'none', '--read-only', '--user', '1000:1000',
      '--interactive', '--log-driver', 'none', '--memory', '256m', '--cpus', '1', '--pids-limit', '16', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges=true', '--entrypoint', ENTRY, IMAGE, '-I', '-B', '-S', '-'], { timeout: 5000 });
    requireFact(ok(created) && /^[0-9a-f]{64}$/.test(created.stdout.trim()), 'CREATE_REPLY_UNKNOWN');
    id = created.stdout.trim(); result.containerId = id;
    const before = projection(await inspect(id)); validateContainer(before, id);
    requireFact(!before.Running && before.Status === 'created', 'BEFORE_START');
    owned = true; result.inspections.push(before);
    const collected = await commands.call(['start', '--attach', '--interactive', id], { input: files['collect.py'], timeout: 25000, maxStdout: 1048576 });
    result.collectorCommandIndex = collected.index;
    requireFact(ok(collected) && collected.stderr === '', 'COLLECTOR_FAILED');
    result.inventory = JSON.parse(collected.stdout);
    requireFact(result.inventory.schema === 'c2b-installed-dependencies-v1' && result.inventory.token === TOKEN
      && result.inventory.complete === true && result.inventory.failure === null && result.inventory.deploymentReady === false, 'INVENTORY_INCOMPLETE');
    const stopped = await original();
    requireFact(!stopped.Running && stopped.Status === 'exited' && stopped.ExitCode === 0, 'COLLECTOR_EXIT');
    result.originalStart = stopped.StartedAt;
    result.inventoryComplete = true;
  } catch (error) { result.failure = codeOf(error); }
  finally {
    result.timing.workElapsedMs = performance.now() - started;
    commands?.cleanupDeadline(totalDeadline);
    try {
      if (createAttempted && !owned) {
        result.cleanup.container = 'unknown-create-retained';
        result.unknownCreateObservation = await inspect(id ?? NAME);
      }
      requireFact(!createAttempted || owned, 'OWNERSHIP_UNKNOWN');
      if (owned) {
        let value = await original();
        if (result.originalStart) requireFact(value.StartedAt === result.originalStart, 'START_CHANGED');
        if (value.Running) {
          requireFact(ok(await commands.call(['stop', '--time', '3', id], { timeout: 6000 })), 'STOP_FAILED');
          value = await original();
        }
        requireFact(!value.Running && ['created', 'exited'].includes(value.Status), 'STOP_UNPROVEN');
        requireFact(ok(await commands.call(['rm', id], { timeout: 5000 })), 'REMOVE_FAILED');
        requireFact(absent(await inspect(id), id) && absent(await inspect(NAME), NAME), 'ABSENCE_UNPROVEN');
        result.cleanup.container = 'original-stopped-removed-and-absent';
      }
    } catch (error) { result.cleanup.failures.push(codeOf(error)); }
    result.cleanup.cliChildrenClosed = commands ? await commands.stopRemaining() : true;
    if (!result.cleanup.cliChildrenClosed) result.cleanup.failures.push('CLI_CLOSE_UNPROVEN');
    result.cleanup.proven = result.cleanup.failures.length === 0 && performance.now() < totalDeadline;
    result.inventoryComplete &&= result.timing.workElapsedMs <= 40000;
    result.timing.beforeArchiveElapsedMs = performance.now() - started;
  }
  let disposition;
  if (store.owned) {
    try { disposition = store.archive(result, totalDeadline, started); }
    catch (error) { result.archiveFailure = codeOf(error); store.write('result.json', result); }
  }
  console.log(JSON.stringify(disposition ?? { verdict: 'FAIL', token: TOKEN, deploymentReady: false, result }));
  process.exitCode = disposition?.verdict === 'PASS' ? 0 : 1;
}

try {
  requireFact(process.argv.length === 2 && process.execArgv.length === 0 && process.env.SystemRoot && !process.env.NODE_OPTIONS, 'LAUNCH_ENVIRONMENT');
  const releasePath = join(HERE, 'release.json'); const metadata = lstatSync(releasePath);
  requireFact(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1 && metadata.size <= 16384
    && resolve(realpathSync(releasePath)).toLowerCase() === resolve(releasePath).toLowerCase(), 'RELEASE_PATH');
  const releaseBytes = readFileSync(releasePath);
  const release = JSON.parse(releaseBytes);
  requireFact(release.schema === 'c2b-dependency-release-v1' && release.token === TOKEN, 'RELEASE_SHAPE');
  requireFact(process.platform === 'win32' && process.version === release.node.version && resolve(process.execPath) === resolve(release.node.path)
    && hash(readFileSync(process.execPath)) === release.node.sha256, 'NODE_PIN');
  const files = { 'release.json': releaseBytes };
  for (const [name, expected] of Object.entries(release.files)) {
    requireFact(/^[a-z][a-z0-9.-]*$/.test(name), 'SOURCE_NAME');
    const path = join(HERE, name); const meta = lstatSync(path);
    requireFact(meta.isFile() && !meta.isSymbolicLink() && meta.nlink === 1 && meta.size <= 65536
      && resolve(realpathSync(path)).toLowerCase() === resolve(path).toLowerCase(), 'SOURCE_PATH');
    files[name] = readFileSync(path); requireFact(hash(files[name]) === expected, 'SOURCE_HASH');
  }
  const load = (name) => import(`data:text/javascript;base64,${files[name].toString('base64')}`);
  await run(release, files, { commands: await load('docker-commands.mjs'), evidence: await load('evidence-store.mjs') });
} catch (error) { console.error(JSON.stringify({ verdict: 'FAIL', deploymentReady: false, code: codeOf(error) })); process.exitCode = 1; }
