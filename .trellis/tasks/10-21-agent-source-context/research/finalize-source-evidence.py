from pathlib import Path
import difflib
import hashlib
import json

root = Path(__file__).resolve().parents[4]
evidence = Path(__file__).parent / 's5-s6-recovery'
preimages = evidence / 'preimages'
paths = {p.relative_to(preimages).as_posix() for p in preimages.rglob('*') if p.is_file()}
paths.update(item['path'] for item in json.loads((evidence / 'preimages.json').read_text(encoding='utf-8')))
paths.add('packages/core/src/agents/source-compaction.test.ts')
changes = []
diff = []
for relative in sorted(paths):
    original = preimages / relative
    current = root / relative
    before = original.read_bytes() if original.exists() else None
    after = current.read_bytes() if current.exists() else None
    if before == after:
        continue
    changes.append({'path': relative, 'new': before is None,
                    'beforeSha256': hashlib.sha256(before).hexdigest() if before is not None else None,
                    'afterSha256': hashlib.sha256(after).hexdigest() if after is not None else None})
    diff.extend(difflib.unified_diff((before or b'').decode('utf-8').splitlines(keepends=True),
                                   (after or b'').decode('utf-8').splitlines(keepends=True),
                                   fromfile='preimage/' + relative, tofile=relative))
(evidence / 'changed-files.json').write_text(json.dumps(changes, indent=2) + '\n', encoding='utf-8')
(evidence / 'working-preimage.diff').write_text(''.join(diff), encoding='utf-8')
audit = {'paths': len(changes), 'bom': [], 'trailingWhitespace': []}
for item in changes:
    path = root / item['path']
    if not path.exists():
        continue
    raw = path.read_bytes()
    if raw.startswith(b'\xef\xbb\xbf'):
        audit['bom'].append(item['path'])
    if any(line.rstrip() != line for line in raw.decode('utf-8').splitlines()):
        audit['trailingWhitespace'].append(item['path'])
(evidence / 'source-audit.json').write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
print(json.dumps(audit))

latest = {}
reports = ['focused-first', 'adapter-controls', 'compatibility', 'consumers-final', 'consumers-repaired', 'shared-final']
counts = []
for name in reports:
    report = json.loads((evidence / (name + '.json')).read_text(encoding='utf-8'))
    counts.append({'report': name + '.json', 'passed': report['numPassedTests'], 'failed': report['numFailedTests'],
                   'files': len(report['testResults'])})
    for suite in report['testResults']:
        for result in suite['assertionResults']:
            latest[(suite['name'], result['fullName'])] = result['status']
initial = json.loads((evidence / 'consumers-final.json').read_text(encoding='utf-8'))
failures = {}
for suite in initial['testResults']:
    for result in suite['assertionResults']:
        if result['status'] == 'failed':
            reason = result['failureMessages'][0].splitlines()[0]
            failures[reason] = failures.get(reason, 0) + 1
summary = {'reports': counts, 'latestUniqueTests': len(latest),
           'latestPassed': sum(value == 'passed' for value in latest.values()),
           'remainingFailures': [{'file': key[0], 'test': key[1], 'status': value} for key, value in latest.items() if value == 'failed'],
           'consumerInitialFailureReasons': failures,
           'interpretation': 'Last tested status per file and full test name across listed scoped reports; not a new full-suite run.'}
(evidence / 'final-test-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'latestUniqueTests': summary['latestUniqueTests'], 'latestPassed': summary['latestPassed'], 'remainingFailures': len(summary['remainingFailures'])}))
