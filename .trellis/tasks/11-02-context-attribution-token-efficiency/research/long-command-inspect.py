"""Read-only, sanitized inspection of the authorized conversation snapshot.

No shell inputs, conversation bodies, output bodies, or private path names are emitted.
"""
import argparse
import collections
import hashlib
import json
import math
import re
import sqlite3
from pathlib import Path

DEFAULT_DB = Path('H:/TakiAgent-worktrees/t4/target/context-analysis-20261104/conversation-115757.db')
EXPECTED_HASH = 'f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93'


def parse(value, default=None):
    if value is None:
        return {} if default is None else default
    return json.loads(value)


def text_stats(value):
    return {'chars': len(value), 'utf8_bytes': len(value.encode('utf-8'))}


def heuristic_units(value):
    # Match token-estimator.ts text regimes and JavaScript UTF-16 string length.
    cjk = len(re.findall(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]', value))
    utf16_length = len(value.encode('utf-16-le')) // 2
    return cjk + math.ceil((utf16_length - cjk) / 4)


def output_stats(output):
    serialized = json.dumps(output, ensure_ascii=False, separators=(',', ':'))
    result = {'serialized': text_stats(serialized), 'tagged_output_heuristic_units': heuristic_units(serialized)}
    value = output
    if isinstance(value, dict) and value.get('type') in ('json', 'text', 'error-json', 'error-text'):
        result['envelope_type'] = value['type']
        value = value.get('value')
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            result['text'] = text_stats(value)
            result['nonempty_lines'] = len([line for line in value.splitlines() if line.strip()])
            return result
    if isinstance(value, dict):
        result['value_keys'] = sorted(value)
        for key in ('stdout', 'stderr', 'output', 'message', 'content'):
            if isinstance(value.get(key), str):
                result[key] = text_stats(value[key])
        if isinstance(value.get('stderr'), str):
            result['stderr_finite_markers'] = [marker for marker in ('ParserError', 'CommandNotFoundException', 'ParameterBindingException', 'WARNING', 'SyntaxError', 'error', 'warning') if marker in value['stderr']]
        message = value.get('message', '')
        if 'compound or shell commands cannot run without a shell' in message:
            result['error_family'] = 'compound_without_shell'
        elif 'cannot locate' in message and 'trusted PATH (cwd excluded)' in message:
            result['error_family'] = 'program_not_on_trusted_path'
        elif message.startswith('spawn failed:'):
            result['error_family'] = 'spawn_failure'
        elif message:
            result['error_family'] = 'other_unclassified'
        for key in ('exitCode', 'timedOut', 'truncated', 'success', 'ok', 'durationMs', 'status', 'code', 'bytesCaptured', 'stdoutTruncated', 'stderrTruncated'):
            if isinstance(value.get(key), (int, bool)):
                result[key] = value[key]
            elif key in ('status', 'code') and isinstance(value.get(key), str):
                # Finite codes only; never expose arbitrary peer messages or output.
                if value[key].replace('_', '').replace('-', '').isalnum() and len(value[key]) < 50:
                    result[key] = value[key]
    return result


def build(db):
    digest = hashlib.sha256(db.read_bytes()).hexdigest()
    if digest != EXPECTED_HASH:
        raise ValueError('Snapshot hash differs from the authorized baseline')
    connection = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    events = [dict(r) for r in connection.execute('SELECT * FROM run_events ORDER BY occurred_at, seq')]
    for event in events:
        event['payload'] = parse(event['payload_json'])
    recent = [e for e in events if e['occurred_at'] >= '2026-11-02']
    runs = {r['run_id']: dict(r) for r in connection.execute('SELECT * FROM runs')}
    effects = {r['effect_id']: dict(r) for r in connection.execute('SELECT * FROM run_effects')}
    usage = {r['effect_id']: dict(r) for r in connection.execute('SELECT * FROM run_usage')}
    measurements = {e['payload']['effectId']: e for e in events if e['kind'] == 'context.request.measured'}
    model_results = {e['payload']['effectId']: e for e in events if e['kind'] == 'model.response.settled'}
    timeline = [dict(r) for r in connection.execute('SELECT * FROM timeline_messages ORDER BY seq')]
    parts_by_call = collections.defaultdict(list)
    for row in timeline:
        for part in parse(row['parts'], []):
            if part.get('toolCallId'):
                parts_by_call[part['toolCallId']].append((row, part))
    tools = []
    file_aliases = {}
    tool_starts = {e['payload'].get('invocationId'): e for e in recent if e['kind'] == 'tool.call.started'}
    for event in recent:
        if event['kind'] != 'tool.result.settled':
            continue
        p = event['payload']
        model = effects.get(p.get('modelEffectId'), {})
        start = tool_starts.get(p.get('invocationId'), {})
        started_payload = start.get('payload', {})
        identity_valid = (model.get('run_id') == event['run_id'] and model.get('attempt_id') == event['attempt_id']
                          and start.get('run_id') == event['run_id'] and start.get('attempt_id') == event['attempt_id']
                          and all(started_payload.get(k) == p.get(k) for k in ('toolName', 'toolCallId', 'modelEffectId')))
        if not identity_valid:
            raise ValueError('Tool event identity is inconsistent with its originating model Effect')
        m = measurements.get(p.get('modelEffectId'), {}).get('payload', {})
        tool = {k: p.get(k) for k in ('toolName', 'modelEffectId', 'toolCallId', 'invocationId', 'effectId', 'outcome', 'durationMs', 'errorClass', 'errorCode')}
        tool.update({'run_id': event['run_id'], 'event_seq': event['seq'], 'started_at': p.get('startedAt'), 'settled_at': event['occurred_at'],
                     'primary_input_seq': m.get('primaryInputSeq'), 'step': m.get('stepNumber'), 'identity_join': 'exact_effect_invocation_and_call',
                     'source_ref': parse(model.get('source_ref_json'))})
        for row, part in parts_by_call.get(p['toolCallId'], []):
            if part['type'] == 'tool-call':
                tool['call_seq'] = row['seq']
                tool['retained_input_keys'] = sorted(set(part) - {'type', 'toolName', 'toolCallId', 'displayName', 'contextOrigin'})
            elif part['type'] == 'tool-result':
                tool['result_seq'] = row['seq']
                tool['result'] = output_stats(part.get('output'))
                value = part.get('output', {}).get('value')
                if isinstance(value, dict) and isinstance(value.get('path'), str):
                    path = value['path']
                    file_aliases.setdefault(path, f'file-{len(file_aliases) + 1}')
                    tool['file_alias'] = file_aliases[path]
        tools.append(tool)
    cohort = []
    exec_tools = [t for t in tools if t['toolName'] == 'exec']
    for run_id in dict.fromkeys(t['run_id'] for t in exec_tools):
        requests = [e for e in events if e['run_id'] == run_id and e['kind'] == 'model.request.started']
        request_rows = []
        for index, e in enumerate(requests):
            effect_id = e['payload']['effectId']
            u = usage.get(effect_id, {})
            meas = measurements.get(effect_id, {}).get('payload', {})
            response = model_results.get(effect_id, {}).get('payload', {})
            request_rows.append({'ordinal': index + 1, 'effect_id': effect_id, 'time': e['occurred_at'], 'step': meas.get('stepNumber'), 'primary_input_seq': meas.get('primaryInputSeq'),
                                 'request_event_seq': e['seq'], 'measurement_event_seq': measurements.get(effect_id, {}).get('seq'),
                                 'response_event_seq': model_results.get(effect_id, {}).get('seq'), 'window': meas.get('window'),
                                 'usage': {k: u.get(k) for k in ('input_tokens', 'cache_read_tokens', 'cache_read_observed', 'input_no_cache_tokens', 'output_tokens', 'reasoning_tokens')},
                                 'durationMs': response.get('durationMs'), 'finishReason': response.get('finishReason'),
                                 'composition': {k: meas['composition'].get(k) for k in ('estimator', 'totalUnits', 'categories', 'coverage')} if 'composition' in meas else None})
        cohort.append({'run_id': run_id, 'started_at': runs[run_id]['started_at'], 'terminal_at': runs[run_id]['terminal_at'],
                       'request_count': len(request_rows), 'tools': dict(collections.Counter(e['payload'].get('toolName') for e in events if e['run_id'] == run_id and e['kind'] == 'tool.result.settled')),
                       'requests': request_rows})
    summary = [dict(r) for r in connection.execute('SELECT revision,through_seq,updated_at,length(text) AS chars FROM conversation_summary')]
    for cohort_run in cohort:
        rows = cohort_run['requests']
        cohort_run['usage_totals'] = {k: sum(q['usage'][k] or 0 for q in rows) for k in ('input_tokens', 'cache_read_tokens', 'input_no_cache_tokens', 'output_tokens', 'reasoning_tokens')}
        cohort_run['paired_cache_request_count'] = sum(q['usage']['cache_read_observed'] == 1 and q['usage']['cache_read_tokens'] is not None for q in rows)
        cohort_run['model_duration_ms_sum'] = sum(q['durationMs'] or 0 for q in rows)
        cohort_run['exec_duration_ms_sum'] = sum(t['durationMs'] or 0 for t in exec_tools if t['run_id'] == cohort_run['run_id'])
        off_peak_price = (cohort_run['usage_totals']['input_no_cache_tokens'] + 0.02 * cohort_run['usage_totals']['cache_read_tokens'] + 4 * cohort_run['usage_totals']['output_tokens']) / 1_000_000
        # Expose both tariff scenarios rather than infer historical billing or a holiday calendar.
        cohort_run['conditional_flash_cny_off_peak'] = off_peak_price
        cohort_run['conditional_flash_cny_peak'] = off_peak_price * 2
        outputs = [t for t in exec_tools if t['run_id'] == cohort_run['run_id'] and 'result' in t]
        cohort_run['exec_output_once'] = {k: sum(t['result']['serialized'][k] for t in outputs) for k in ('chars', 'utf8_bytes')}
        # Gross native-output proxy only: no source wrapper/argument/provider/cache allocation is inferred.
        cohort_run['exec_output_same_loop_gross'] = {k: sum(t['result']['serialized'][k] * max(0, len(rows) - (t['step'] or 0) - 1) for t in outputs) for k in ('chars', 'utf8_bytes')}
        cohort_run['exec_output_same_loop_heuristic_units'] = sum(t['result']['tagged_output_heuristic_units'] * max(0, len(rows) - (t['step'] or 0) - 1) for t in outputs)
    return {'source_sha256': digest, 'query_scope': 'UTC Nov 2-3 2026 exec-containing Runs; primary and non-primary separated by captured primaryInputSeq',
            'proxy_definition': 'tagged retained output compact JSON; heuristic text regimes match token-estimator.ts; excludes arguments, source/render wrappers and media',
            'summary': summary, 'exec_count': len(exec_tools), 'execs': exec_tools,
            'case_tools': [t for t in tools if t['run_id'] in {r['run_id'] for r in cohort}], 'exec_runs': cohort}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    data = build(args.db)
    if args.out:
        # The reproducible aggregate may only be written alongside this helper.
        destination = args.out.resolve()
        if destination.parent != Path(__file__).resolve().parent or not destination.name.startswith('long-command'):
            raise ValueError('Output must be a long-command file in the task research directory')
        destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    else:
        print(json.dumps({**{k: v for k, v in data.items() if k != 'exec_runs'}, 'exec_runs': [{k: v for k, v in r.items() if k != 'requests'} for r in data['exec_runs']]}, ensure_ascii=False, indent=2))
