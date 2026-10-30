from pathlib import Path
import difflib
import hashlib
import json

root = Path(__file__).resolve().parents[4]
research = Path(__file__).parent
evidence = research / 's5-s6-acceptance'
paths = [
    'packages/core/src/agents/compaction-pass.ts',
    'packages/core/src/agents/source-compaction.test.ts',
    'packages/core/src/agents/index.md',
    'packages/core/src/agents/source-context-real.test.ts',
    'packages/core/src/co-watching/source-preparation-real.test.ts',
    'packages/core/src/memory/source-local-memory-real.test.ts',
    'packages/core/src/testing/co-watching-fixture.ts',
    'packages/core/src/testing/co-watching-tool-fixture.ts',
    'packages/core/src/testing/source-live-evidence.ts',
    'packages/core/src/testing/source-live-evidence.test.ts',
    'packages/core/src/testing/index.md',
]
preimages = {entry['path']: entry for entry in json.loads((evidence / 'preimages.json').read_text(encoding='utf-8'))}
changes = []
diff = []
audit = {'paths': len(paths), 'missing': [], 'bom': [], 'trailingWhitespace': []}
for relative in paths:
    current = root / relative
    if not current.exists():
        audit['missing'].append(relative)
        continue
    before_path = root / preimages[relative]['preimage'] if relative in preimages else None
    before = before_path.read_bytes() if before_path else None
    after = current.read_bytes()
    changes.append({'path': relative, 'newAtAcceptanceResume': before is None,
                    'beforeSha256': hashlib.sha256(before).hexdigest() if before is not None else None,
                    'afterSha256': hashlib.sha256(after).hexdigest()})
    diff.extend(difflib.unified_diff((before or b'').decode('utf-8').splitlines(keepends=True),
                                   after.decode('utf-8').splitlines(keepends=True),
                                   fromfile='acceptance-preimage/' + relative, tofile=relative))
    if after.startswith(b'\xef\xbb\xbf'):
        audit['bom'].append(relative)
    if any(line.rstrip() != line for line in after.decode('utf-8').splitlines()):
        audit['trailingWhitespace'].append(relative)

(evidence / 'changed-files.json').write_text(json.dumps(changes, indent=2) + '\n', encoding='utf-8')
(evidence / 'working-preimage.diff').write_text(''.join(diff), encoding='utf-8')
(evidence / 'source-audit.json').write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
original = json.loads((research / 's5-s6-recovery/changed-files.json').read_text(encoding='utf-8'))
union = {entry['path']: entry for entry in original}
for entry in changes:
    previous = union.get(entry['path'])
    union[entry['path']] = {**(previous or entry), 'afterSha256': entry['afterSha256']}
(evidence / 'source-manifest-current.json').write_text(json.dumps(list(union.values()), indent=2) + '\n', encoding='utf-8')

latest = {}
reports = []
for report_path in sorted(evidence.glob('tests-*.json'), key=lambda path: path.stat().st_mtime_ns):
    if report_path.name.startswith('tests-live-'):
        continue
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if 'testResults' not in report:
        continue
    reports.append({'report': report_path.name, 'passed': report['numPassedTests'], 'failed': report['numFailedTests']})
    for suite in report['testResults']:
        for result in suite['assertionResults']:
            latest[(suite['name'], result['fullName'])] = result['status']
summary = {'reports': reports, 'latestPassed': sum(status == 'passed' for status in latest.values()),
           'latestFailed': sum(status == 'failed' for status in latest.values()),
           'latestSkipped': sum(status in ['pending', 'skipped'] for status in latest.values()),
           'interpretation': 'Acceptance supplement only; previous 290 scoped results remain historical evidence.'}
(evidence / 'test-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'audit': audit, 'currentManifestPaths': len(union), 'testSummary': summary}))
