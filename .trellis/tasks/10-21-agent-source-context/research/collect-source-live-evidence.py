from pathlib import Path
import json

evidence = Path(__file__).parent / 's5-s6-acceptance'
batches = [
    ('a1-a3-live-01', ['a1-external.json', 'a2-self-report-failed.json']),
    ('a2-a3-live-02', ['a2-self-report.json', 'a3-mixed-unknown.json']),
    ('co-watching-live-01', ['result.json']),
    ('local-memory-live-01', []),
    ('a3-compaction-fix-live-01', ['a3-mixed-unknown.json']),
    ('a1-a2-final-prompt-live-01', ['a1-external.json', 'a2-self-report.json']),
]
rows = []
for name, usage_files in batches:
    directory = evidence / name
    if not (directory / 'run.json').exists():
        continue
    read = lambda filename: json.loads((directory / filename).read_text(encoding='utf-8'))
    run = read('run.json')
    requests = read('requests.json')
    usage = []
    for filename in usage_files:
        if (directory / filename).exists():
            usage.extend(read(filename).get('usage', []))
    generations = read('generations.json') if (directory / 'generations.json').exists() else []
    input_values = [item.get('input_tokens') for item in usage] + [item.get('inputTokens') for item in generations]
    output_values = [item.get('output_tokens') for item in usage] + [item.get('outputTokens') for item in generations]
    rows.append({'batch': name, 'upstreamRequests': sum(item.get('upstreamAttempted') is True for item in requests),
                 'observedRequests': len(requests), 'successfulHttpResponses': sum(item.get('status') == 200 for item in requests),
                 'physicalCap': run['physicalRequestsLimit'], 'reportedGenerationUsages': len(usage) + len(generations),
                 'inputTokens': sum(value for value in input_values if isinstance(value, int)),
                 'outputTokens': sum(value for value in output_values if isinstance(value, int)),
                 'unknownTokenSamples': sum(not isinstance(value, int) for value in input_values + output_values),
                 'requestedModel': run['requestedModel'],
                 'returnedModels': sorted({item.get('model_id') for item in usage if item.get('model_id')}
                                          | {item.get('modelId') for item in generations if item.get('modelId')}),
                 'sourceUnchanged': run['sourceUnchanged'], 'deadlineExceeded': run['deadlineExceeded'],
                 'observationFailures': run['observationFailures'], 'completedStructuralStages': run['completed']})
summary = {'batches': rows, 'totals': {key: sum(row[key] for row in rows) for key in
                                    ['upstreamRequests', 'reportedGenerationUsages', 'inputTokens', 'outputTokens', 'unknownTokenSamples']},
           'interpretation': 'Reported real-provider usage only; scripted primary/private generations are excluded. Structural completion does not establish semantic or human acceptance. The first failed campaign is included.'}
(evidence / 'live-usage-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary))
