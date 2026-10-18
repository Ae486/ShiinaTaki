// Independent review harness: extract current helper bytes; never import the launcher.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const R = path.dirname(OUT);
const CASE = '1b05d2f6-494c-4a6d-a601-1e807eca1486';
const OLD = '13f04d85-ee84-408e-890c-88922e36c69e';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(R, name));
const self = JSON.parse(read('c2a-database-persistence-r2-self-check.json'));
const prior = JSON.parse(read('c2a-database-persistence-exact-byte-review-1b05d2f6.json'));
const source = read('docker-database/run-persistence.ts').toString('utf8');
const helper = source.slice(source.indexOf('async function engineTime()'), source.indexOf('\nfunction command('));
assert(helper.startsWith('async function engineTime()'));
assert.equal(sha(Buffer.from(source)), 'c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27');
const restored = source.replace(helper, prior.phaseA.clockRepair.source);
assert.notEqual(restored, source);
assert.equal(sha(Buffer.from(restored)), 'b3736ef4cd510023434ea8f0864296f2970fec02892543af370a324595ec6f76');
// The round-1 helper is hash-bound by the reconstructed entire file, not trusted as executable code.
const fixtureChecks = self.caseBinding.files.map(pin => {
  const bytes = read(pin.file);
  const text = pin.file.endsWith('.ts') ? restored : bytes.toString('utf8');
  assert.equal(text.split(CASE).length, 2);
  assert.equal(text.split(OLD).length, 1);
  assert.equal(sha(Buffer.from(text)), pin.afterSha256);
  const normalized = text.replace(CASE, OLD);
  assert.equal(sha(Buffer.from(normalized)), pin.beforeSha256);
  const lines = text.split('\n').flatMap((line, i) => line !== normalized.split('\n')[i] ? [i + 1] : []);
  assert.deepEqual(lines, pin.differingLines);
  return { file: pin.file, bytes: bytes.length, sha256: sha(bytes), tokenOccurrences: 1, differingTokenLines: lines,
    round1Sha256: sha(Buffer.from(text)), normalizedRound1Sha256: sha(Buffer.from(normalized)), pass: true };
});
const nativeChecks = self.caseBinding.expectedStagedContext.entries.map(pin => {
  const absolute = 'H:/hindsight/' + pin.path;
  const bytes = fs.readFileSync(absolute);
  assert.equal(sha(bytes), pin.upstreamSha256);
  if (!pin.replacement) assert.equal(bytes.length, pin.bytes);
  return { path: absolute, bytes: bytes.length, sha256: sha(bytes), pass: true };
});
const modules = fs.readdirSync('H:/hindsight/docker/standalone/managed_bootstrap', {withFileTypes:true})
  .filter(e => e.isFile() && e.name.endsWith('.py')).map(e => e.name).sort();
assert.equal(modules.length, 11);
assert.deepEqual(modules, nativeChecks.slice(1).map(e => path.basename(e.path)).sort());
const manifestBytes = read('c2a-implementation-source-manifest.json');
assert.equal(sha(manifestBytes), 'f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2');
const manifestChecks = JSON.parse(manifestBytes).files.map(pin => {
  const bytes = fs.readFileSync(pin.absolutePath);
  assert.equal(sha(bytes), pin.afterSha256, pin.absolutePath);
  return {path: pin.absolutePath, bytes: bytes.length, sha256: sha(bytes), pass: true};
});
assert.match(source, /capacity\(\); const since = await engineTime\(\);/);
assert.match(source, /const until = await engineTime\(\);/);
const queries = source.split('\n').filter(line => line.includes('const events =') || line.includes('const volumeEvents ='));
assert.equal(queries.length, 2);
queries.forEach(line => assert(line.includes('["events", "--since", since, "--until", until,')));
assert(!helper.includes('Date.now') && !helper.includes('Date.parse') && !helper.includes('catch'));
const requireSource = source.slice(source.indexOf('function requireFact('), source.indexOf('\nfunction failureCode('));
const js = ts.transpileModule(requireSource + '\n' + helper, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const inputs = [
  ['2026-10-15T12:49:45.123456789Z', true], ['2026-10-15T12:49:45Z', true],
  ['2026-02-30T00:00:00Z', false], ['2026-13-01T00:00:00Z', false],
  ['2026-10-15T24:00:00Z', false], ['2026-10-15T12:49:45.123456789+08:00', false], ['not-a-time', false],
];
const results = [];
for (const [input, accepted] of inputs) {
  const calls = [];
  const budgets = [];
  const context = vm.createContext({Buffer, AbortSignal, fixture:{deploymentRegistration:{reviewMock:true}},
    budget: n => {budgets.push(n); return n;},
    dockerExchange: async (registration, options) => {
      calls.push({registration, argv:options.argv, maxBytes:options.maxBytes});
      return Buffer.from(input);
    }});
  vm.runInContext(js, context, {timeout:1000});
  let row;
  try {
    const returned = await vm.runInContext('engineTime()', context, {timeout:1000});
    row = {input, result:'ACCEPTED', returned, unchanged:returned === input, passed:accepted && returned === input};
  } catch (e) {row = {input, result:'REJECTED', error:e.message, passed:!accepted && e.message === 'C2A_CHECK_FAILED'};}
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0].argv), JSON.stringify(['info','--format','{{.SystemTime}}']));
  assert.equal(calls[0].maxBytes, 4096);
  assert.deepEqual(budgets, [10000]);
  row.calls = calls; row.budgetMs = budgets[0]; results.push(row);
  console.log(JSON.stringify(row));
}
assert(results.every(r => r.passed));
const record = {recordedAt:new Date().toISOString(), node:process.version, caseId:CASE,
  fixtureChecks, helperSource:helper, helperSha256:sha(Buffer.from(helper)),
  round1Reconstruction:{sha256:sha(Buffer.from(restored)), bytes:Buffer.byteLength(restored), onlyHelperChanged:true},
  existingThresholdsBudgetsRetriesFailureCodesUnchanged:true, querySources:queries,
  sevenInputResults:results, nativeChecks, acceptedSourceManifest:{sha256:sha(manifestBytes), checks:manifestChecks},
  scope:'No Docker command, launcher import, build, runtime resource, or source modification.',
  executionOrderingConflict:'Frozen launcher always calls cleanup before writeEvidence; clarification pending.'};
fs.writeFileSync(path.join(OUT,'phase-a-byte-checks.json'), JSON.stringify(record,null,2)+'\n', {flag:'wx'});
fs.writeFileSync(path.join(OUT,'reviewed-engineTime.txt'), helper+'\n', {flag:'wx'});
console.log(JSON.stringify({byteChecks:'PASS', sevenInputs:'7/7 PASS', nativePins:nativeChecks.length, sourceManifestPins:manifestChecks.length}));
