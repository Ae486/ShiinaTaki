/** Fresh marked stage, bounded archive readback, and exact owned staging removal. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();

export function checkedPath(path) {
  const absolute = resolve(path);
  const parts = relative(parse(absolute).root, absolute).split(/[\\/]/).filter(Boolean);
  let current = parse(absolute).root;
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !samePath(realpathSync(current), current)) throw new Error('PATH_REDIRECTION');
  }
  return absolute;
}

export class EvidenceStore {
  constructor(settings, files) {
    this.settings = settings;
    this.files = files;
    this.owned = false;
    this.archiveCreated = false;
    this.names = new Set(['.c2b-relay-owner', 'commands.json', 'result.json',
      '.commands.json.next', '.result.json.next', ...Object.keys(files)]);
  }

  create() {
    const { stage, archive, stageRoot, token } = this.settings;
    if (existsSync(stage) || existsSync(archive)) throw new Error('RESOURCE_PATH_EXISTS');
    checkedPath(dirname(stageRoot));
    checkedPath(dirname(archive));
    if (!existsSync(stageRoot)) mkdirSync(stageRoot);
    checkedPath(stageRoot);
    if (!samePath(dirname(stage), stageRoot) || !isAbsolute(stage)) throw new Error('STAGE_SCOPE');
    mkdirSync(stage);
    this.owned = true;
    writeFileSync(join(stage, '.c2b-relay-owner'), token, { flag: 'wx', flush: true });
    mkdirSync(join(stage, 'client-config'));
    for (const [name, bytes] of Object.entries(this.files)) writeFileSync(join(stage, name), bytes, { flag: 'wx', flush: true });
    this.write('commands.json', []);
  }

  assertOwned() {
    checkedPath(this.settings.stage);
    if (!this.owned || readFileSync(join(this.settings.stage, '.c2b-relay-owner'), 'utf8') !== this.settings.token) {
      throw new Error('STAGE_OWNERSHIP');
    }
  }

  write(name, value) {
    this.assertOwned();
    if (!['commands.json', 'result.json'].includes(name)) throw new Error('EVIDENCE_NAME');
    const path = join(this.settings.stage, name);
    if (existsSync(path)) {
      checkedPath(path);
      if (!lstatSync(path).isFile() || lstatSync(path).nlink !== 1) throw new Error('EVIDENCE_FILE_CHANGED');
    }
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    if (bytes.length > 2 * 1024 * 1024) throw new Error('EVIDENCE_BOUND');
    const pending = join(this.settings.stage, `.${name}.next`);
    // A partial interrupted write remains inspectable and blocks another dispatch.
    writeFileSync(pending, bytes, { flag: 'wx', flush: true });
    renameSync(pending, path);
  }

  inventory() {
    this.assertOwned();
    checkedPath(this.settings.stageRoot);
    if (!samePath(dirname(this.settings.stage), this.settings.stageRoot)) throw new Error('STAGE_ANCESTOR');
    const entries = readdirSync(this.settings.stage);
    if (entries.length > this.names.size + 1) throw new Error('STAGE_ENTRY_BOUND');
    const files = {};
    let total = 0;
    for (const name of entries) {
      const path = join(this.settings.stage, name);
      checkedPath(path);
      const metadata = lstatSync(path);
      if (name === 'client-config') {
        if (!metadata.isDirectory() || readdirSync(path).length !== 0) throw new Error('CLIENT_CONFIG_CHANGED');
        continue;
      }
      if (!this.names.has(name) || !metadata.isFile() || metadata.nlink !== 1) throw new Error('UNKNOWN_STAGE_ENTRY');
      total += metadata.size;
      if (total > 4 * 1024 * 1024) throw new Error('STAGE_BYTE_BOUND');
      const bytes = readFileSync(path);
      files[name] = { bytes, sha256: digest(bytes) };
    }
    return { files, total };
  }

  archive(result, deadline, started) {
    if (performance.now() >= deadline) throw new Error('ARCHIVE_DEADLINE');
    this.write('result.json', result);
    const snapshot = this.inventory();
    const destination = this.settings.archive;
    checkedPath(dirname(destination));
    if (existsSync(destination)) throw new Error('ARCHIVE_COLLISION');
    mkdirSync(destination);
    this.archiveCreated = true;
    checkedPath(destination);
    const hashes = {};
    for (const [name, item] of Object.entries(snapshot.files)) {
      const to = join(destination, name);
      writeFileSync(to, item.bytes, { flag: 'wx', flush: true });
      checkedPath(to);
      if (digest(readFileSync(to)) !== item.sha256) throw new Error('ARCHIVE_READBACK');
      hashes[name] = item.sha256;
    }
    const recheck = this.inventory();
    if (JSON.stringify(Object.fromEntries(Object.entries(recheck.files).map(([name, item]) => [name, item.sha256]))) !== JSON.stringify(hashes)) {
      throw new Error('STAGE_CHANGED_DURING_ARCHIVE');
    }
    if (performance.now() >= deadline) throw new Error('ARCHIVE_DEADLINE');
    // Every ancestor/final path, leaf, marker and byte cap was rechecked immediately above.
    // Only this frozen stage is recursive; neither its parent, archive, nor source is removed.
    let stagingRemoved = false;
    if (result.cleanup.proven) {
      rmSync(this.settings.stage, { recursive: true });
      if (existsSync(this.settings.stage)) throw new Error('STAGE_REMAINS');
      stagingRemoved = true;
    }
    const disposition = {
      schema: 'c2b-relay-disposition-v1', token: this.settings.token,
      verdict: result.transportPassed && result.cleanup.proven && stagingRemoved && performance.now() <= deadline ? 'PASS' : 'FAIL', deploymentReady: false,
      scope: result.scope, stage: this.settings.stage, stagingRemoved,
      archive: destination, archiveReadback: true, stageBytes: snapshot.total, hashes,
      overallElapsedMs: performance.now() - started,
      containerDisposition: result.cleanup.container, hostPort: result.cleanup.port,
    };
    const dispositionPath = join(destination, 'disposition.json');
    const dispositionBytes = Buffer.from(JSON.stringify(disposition, null, 2) + '\n');
    writeFileSync(dispositionPath, dispositionBytes, { flag: 'wx', flush: true });
    if (digest(readFileSync(dispositionPath)) !== digest(dispositionBytes)) throw new Error('DISPOSITION_READBACK');
    if (performance.now() > deadline) {
      disposition.verdict = 'FAIL';
      disposition.deadlineExceeded = true;
      disposition.overallElapsedMs = performance.now() - started;
      writeFileSync(dispositionPath, JSON.stringify(disposition, null, 2) + '\n', { flag: 'w', flush: true });
    }
    return disposition;
  }
}
