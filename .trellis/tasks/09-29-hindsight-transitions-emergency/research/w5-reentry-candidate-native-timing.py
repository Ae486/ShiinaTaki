"""PARENT-RUN ONLY: bounded read-only Native baseline/preflight/predecessor timing.

No apply/admit, explicit row locks, HTTP, engine or model construction. Existing
parent custody, stopped-pair ownership and preservation checks remain in force.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sqlite3
import time

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("candidate_audit", HERE / "w5-reentry-candidate-native-audit.py")
candidate_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate_audit)
audit = candidate_audit.audit
INPUT = HERE.parents[3] / ".trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205"
RESULT = {"diagnosticLimits": {"wholeSeconds": 180, "sqlSeconds": 30}, "stages": [], "queries": {},
          "meaning": "Actual read-only Character baseline/preflight/predecessor timings. No delta apply or Native write.",
          "completed": False}


def fq_table(table):
    assert re.fullmatch(r"[a-z_]+", table)
    return f'"{table}"'


class TimedReadConnection:
    backend_type = "postgresql"

    def __init__(self, raw):
        from hindsight_api.engine.db.postgresql import PostgresConnection
        self.delegate = PostgresConnection(raw)

    def parse_json(self, value):
        return self.delegate.parse_json(value)

    async def call(self, method, query, *args, **kwargs):
        normalized = " ".join(query.split())
        allowed = normalized.upper().startswith("SELECT ") or normalized.upper() == "SET LOCAL TIME ZONE 'UTC'"
        forbidden = re.search(r"\b(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|LOCK|SET_CONFIG)\b", normalized, re.I)
        explicit_lock = re.search(r"\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b", normalized, re.I)
        if not allowed or forbidden or explicit_lock:
            RESULT["refusedSqlHash"] = hashlib.sha256(query.encode()).hexdigest()
            raise RuntimeError("READ_ONLY_DIAGNOSTIC_QUERY_REFUSED")
        # SQL is source-authored, with every data value bound separately. Never
        # record arguments, rows, bodies, credentials or exception messages.
        key = method + ":" + normalized
        stats = RESULT["queries"].setdefault(key, {"calls": 0, "milliseconds": 0, "maxMs": 0})
        stats["calls"] += 1
        started = time.perf_counter()
        try:
            kwargs["timeout"] = min(30, kwargs.get("timeout") or 30)
            return await getattr(self.delegate, method)(query, *args, **kwargs)
        finally:
            elapsed = (time.perf_counter()-started)*1000
            stats["milliseconds"] += elapsed
            stats["maxMs"] = max(stats["maxMs"], elapsed)

    async def fetch(self, query, *args, **kwargs):
        return await self.call("fetch", query, *args, **kwargs)

    async def fetchrow(self, query, *args, **kwargs):
        return await self.call("fetchrow", query, *args, **kwargs)

    async def fetchval(self, query, *args, **kwargs):
        return await self.call("fetchval", query, *args, **kwargs)

    async def execute(self, query, *args, **kwargs):
        return await self.call("execute", query, *args, **kwargs)


async def stage(name, operation):
    item = {"name": name, "completed": False}
    RESULT["stages"].append(item)
    started = time.perf_counter()
    try:
        value = await operation()
        item["completed"] = True
        return value
    finally:
        item["milliseconds"] = (time.perf_counter()-started)*1000
        print(json.dumps({"marker": "W5_CANDIDATE_NATIVE_TIMING", **item}), flush=True)


async def measure(password):
    import asyncpg
    from hindsight_api.engine.application_state.models import TakiApplicationNamespace
    from hindsight_api.engine.application_state.store import ApplicationStateStore
    from hindsight_api.engine.memories import set_memories
    from hindsight_api.engine.memories.postgres import PostgresMemories
    from hindsight_api.engine.transition_models import TakiTransitionFinalProof
    from hindsight_api.engine.transition_snapshot import capture_transition_baseline
    from hindsight_api.engine.transfer.transition_delta_application import _predecessors
    from hindsight_api.engine.transfer.transition_delta_models import TakiTransitionDeltaRequest, transition_delta_hash
    from hindsight_api.engine.transfer.transition_delta_preflight import preflight_transition_delta

    manifest = json.loads((INPUT / "copy-manifest.json").read_bytes())
    data = (INPUT / "application.sqlite").read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest["files"]["application.sqlite"]["sha256"]
    sqlite = sqlite3.connect((INPUT / "application.sqlite").resolve().as_uri()+"?mode=ro&immutable=1", uri=True)
    try:
        row = sqlite.execute("SELECT body FROM memory_transition_preparations WHERE transition_id=?",
                             (str(candidate_audit.TRANSITION),)).fetchone()
        prepared = json.loads(row[0])
    finally:
        sqlite.close()
    request = TakiTransitionDeltaRequest.model_validate(prepared["request"])
    bank_id = prepared["scope"]["nativeBankId"]
    assert request.operation_id == candidate_audit.DELTA_OPERATION
    assert request.request_hash == candidate_audit.DELTA_HASH == transition_delta_hash(bank_id, request)
    # Explicit SQL store construction prevents a configured third-party extension
    # from running. This initializes no engine, pool, embedding or model service.
    set_memories(PostgresMemories({}))
    raw = await asyncpg.connect(host="127.0.0.1", port=audit.owner.PG_PORT, user="taki_real",
                                password=password, database="taki_real", timeout=10, command_timeout=30)
    try:
        await raw.execute("SET default_transaction_read_only=on")
        await raw.execute("SET statement_timeout='30s'")
        assert Path(await raw.fetchval("SHOW data_directory")).resolve() == (audit.owner.ROOT / "data").resolve()
        async with raw.transaction(isolation="repeatable_read", readonly=True):
            RESULT["readOnly"] = await raw.fetchval("SHOW transaction_read_only")
            assert RESULT["readOnly"] == "on"
            raw_proof = await raw.fetchval("SELECT proof::text FROM memory_transition_requests WHERE bank_id=$1 AND transition_id=$2",
                                           bank_id, request.baseline_transition_id)
            proof = TakiTransitionFinalProof.model_validate(json.loads(raw_proof))
            assert proof.proof_hash == request.baseline_proof_hash
            conn = TimedReadConnection(raw)
            baseline = await stage("capture_transition_baseline", lambda: capture_transition_baseline(conn, fq_table, bank_id))
            RESULT["baselineMatches"] = baseline.baseline_hash == proof.baseline_hash
            assert RESULT["baselineMatches"], "BASELINE_MISMATCH"
            RESULT["auxiliaryRecords"] = len(baseline.auxiliary)
            plan = await stage("preflight_transition_delta", lambda: preflight_transition_delta(conn, fq_table, bank_id, request))
            RESULT["nativeDescriptors"] = len(plan.descriptors)
            namespace = TakiApplicationNamespace(provider_lineage=prepared["target"]["request"]["provider_lineage"],
                                                  bank_generation=prepared["target"]["request"]["bank_generation"])
            store = ApplicationStateStore(conn, fq_table, bank_id, namespace)
            predecessors = await stage("application_predecessors", lambda: _predecessors(store, request))
            RESULT["applicationPredecessors"] = len(predecessors)
            RESULT["completed"] = True
    finally:
        await raw.close(timeout=10)


async def timing_audit(password):
    native = {}
    try:
        async with asyncio.timeout(180):
            # Keep the existing immutable completed-step/action preservation gate.
            native = await candidate_audit.original_audit(password)
            await measure(password)
    except Exception as error:
        RESULT["errorClass"] = type(error).__name__
    finally:
        native["candidateTiming"] = RESULT
    return native


if __name__ == "__main__":
    audit.audit_core = candidate_audit.pinned_core
    audit.audit_native = timing_audit
    audit.main()
    assert RESULT["completed"] and "errorClass" not in RESULT, "READ_ONLY_TIMING_INCOMPLETE"
