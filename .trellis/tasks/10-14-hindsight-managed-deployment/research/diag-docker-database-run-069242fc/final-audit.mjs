// Read-only verification after the single diagnostic execution and owned cleanup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const research = path.dirname(out);
const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const manifest = read('diagnostic-manifest.json');
const before = read('preflight.json');
const persistence = read('persistence.json');
const commands = [];
function docker(args) {
  const argv = ['--host', 'npipe:////./pipe/dockerDesktopLinuxEngine', '--config', out + '/client-config', ...args];
  const result = spawnSync('C:/Program Files/Docker/Docker/resources/bin/docker.exe', argv, {
    cwd: out, env: { SystemRoot: process.env.SystemRoot }, windowsHide: true,
    shell: false, timeout: 15000, maxBuffer: 256 * 1024, encoding: 'utf8',
  });
  commands.push({ args: argv, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0 || result.error) throw new Error('READ_ONLY_AUDIT_FAILED');
  return result.stdout.trim();
}
const lines = value => value ? value.split(/\r?\n/) : [];
const containers = lines(docker(['container', 'inspect', '--format',
  '{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}}}',
  ...before.containers.map(c => c.name)])).map(line => JSON.parse(line));
const deltas = before.containers.map(b => {
  const after = containers.find(a => a.name === b.name);
  return { name: b.name, before: b, after, idUnchanged: after?.id === b.id,
    startTimeUnchanged: after?.startedAt === b.startedAt, statusUnchanged: after?.status === b.status };
});
const allIds = lines(docker(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}']));
const ownedVolume = persistence.cleanupOriginal.volume;
const volumeMatches = lines(docker(['volume', 'ls', '--filter', 'name=' + ownedVolume, '--format', '{{.Name}}']));
const tagMatches = docker(['image', 'ls', '--filter', 'reference=' + manifest.imageTag, '--format', '{{.ID}}']);
const engine = JSON.parse(docker(['info', '--format', '{"id":{{json .ID}},"version":{{json .ServerVersion}},"time":{{json .SystemTime}}}']));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const originalHashes = Object.entries(manifest.originalHashes).map(([name, expected]) => {
  const after = hash(research + '/docker-database/' + name);
  return { name, before: expected, after, unchanged: after === expected };
});
const archive = read('stage-archive-manifest.json');
const archiveVerified = archive.entries.every(e => fs.statSync(out + '/' + e.path).size === e.bytes && hash(out + '/' + e.path) === e.sha256);
const record = {
  recordedAt: new Date().toISOString(), caseId: manifest.caseId,
  stageAbsent: !fs.existsSync(manifest.stage), protectedRootAbsent: !fs.existsSync(manifest.protectedRoot),
  tagAbsent: tagMatches === '', ownedContainerAbsent: !allIds.includes(persistence.cleanupOriginal.containerId),
  ownedVolumeAbsent: !volumeMatches.includes(ownedVolume),
  exactlyEightOriginalContainers: allIds.length === 8 && before.containers.every(c => allIds.includes(c.id)),
  allEightUnchanged: deltas.every(d => d.idUnchanged && d.startTimeUnchanged && d.statusUnchanged),
  engineIdUnchanged: engine.id === before.engineBefore.value.id, engine,
  originalHashes, originalsUnchanged: originalHashes.every(h => h.unchanged),
  archiveVerified, archivedStageFiles: archive.files, deltas, commands,
};
record.passed = ['stageAbsent', 'protectedRootAbsent', 'tagAbsent', 'ownedContainerAbsent', 'ownedVolumeAbsent',
  'exactlyEightOriginalContainers', 'allEightUnchanged', 'engineIdUnchanged', 'originalsUnchanged', 'archiveVerified'].every(k => record[k]);
fs.writeFileSync(out + '/final-audit.json', JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: record.passed, stageAbsent: record.stageAbsent, protectedRootAbsent: record.protectedRootAbsent,
  tagAbsent: record.tagAbsent, ownedContainerAbsent: record.ownedContainerAbsent, ownedVolumeAbsent: record.ownedVolumeAbsent,
  allEightUnchanged: record.allEightUnchanged, originalsUnchanged: record.originalsUnchanged,
  archiveVerified: record.archiveVerified, archivedStageFiles: record.archivedStageFiles }));
if (!record.passed) process.exitCode = 1;
