"""PARENT-RUN ONLY: fresh physical clone, stored definitions and SELECT plans.

No apply, DELETE, publication function, engine, migration, model or password
mutation. Default invocation only describes the proposed diagnostic. The parent
must review this file before explicitly passing --run-reviewed-clone.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import re
import socket
import sys
import time
import uuid
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SCHEMA = "public"
QUERY_SECONDS = 10
TOTAL_SECONDS = 120
MAX_QUERIES = 128
MAX_CASES = 16
READER_MANIFEST = HERE / "w5-candidate-reader-queue-source-manifest.json"
READER_HASH = "b38a102c5e6b9737afc62c6f4063f7dc9b7ecda6e39039e7026aab6555bda47f"
DEPENDENCIES = {
    "w5-reentry-candidate-native-clone.py": "a58da783153ab5e0052310584877b410e0303f473543ea3147eb6e203867b03e",
    "w5-reentry-candidate-native-audit.py": "200bed1bbb2123d287b08aedd1662b09c4b29e3556184a2cb447f728ad3cd768",
    "w5-return-recovery-audit.py": "f224430c3efbbba0697fce28bec218da06bdb707b462c6b46564e177ba196e62",
    "w5-reused-native.py": "cbda42b4ddf0338e2973e0239beb7109963648b6f61a3b96b9c3f842f5e46e00",
    "inspect-native-reuse.py": "a2218b8818e293bf1fd4c8012bb878a7d569d8345fdbf7f599afb39171fe248e",
    "w5-supervisor-shutdown.py": "5d349f718e608258e562a18739a22355da85bb1dd42a19d4e7dba6d947e8d25d",
    "w5_reentry_gate.py": "4b0c8c02d62d206f3430b409cdec34d5dbbf11c8e7527e03a344cbeda9d5dee3",
}
ASSOCIATIONS = ("memory_links", "unit_entities", "entity_cooccurrences")
ENDPOINTS = ("memory_units", "invalidated_memory_units", "entities")
FUNCTIONS = ("guard_transition_association_write", "check_transition_publication", "transition_write_permit")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_sources() -> None:
    assert digest(READER_MANIFEST) == READER_HASH, "READER_MANIFEST_CHANGED"
    for row in json.loads(READER_MANIFEST.read_text(encoding="utf-8"))["files"]:
        assert digest(Path(row["path"])) == row["sha256"], "READER_SOURCE_CHANGED"
    for name, expected in DEPENDENCIES.items():
        assert digest(HERE / name) == expected, "CUSTODY_HELPER_CHANGED"


def table(name: str) -> str:
    assert name in {*ASSOCIATIONS, *ENDPOINTS, "banks", "memory_transition_requests"}
    return f'"{SCHEMA}"."{name}"'


def endpoint_query(*, native_uuid: bool) -> str:
    parts = ["SELECT item->>'bank_id' AS bank_id"]
    for name, fields in (
        ("memory_units", ("unit_id", "from_unit_id", "to_unit_id")),
        ("invalidated_memory_units", ("unit_id", "from_unit_id", "to_unit_id")),
        ("entities", ("entity_id", "entity_id_1", "entity_id_2")),
    ):
        values = ",".join(f"(item->>'{field}')::uuid" if native_uuid else f"item->>'{field}'" for field in fields)
        column = "id" if native_uuid else "id::text"
        parts.append(f"SELECT bank_id FROM {table(name)} WHERE {column} IN ({values})")
    return (
        "SELECT DISTINCT bank_id FROM unnest($1::jsonb[]) AS row_data(item) CROSS JOIN LATERAL ("
        + " UNION ".join(parts)
        + ") owned WHERE bank_id IS NOT NULL ORDER BY bank_id"
    )


def normalized_lookup(sql: str) -> str:
    # The reviewed function may qualify public explicitly or rely on its
    # original search path. The diagnostic always uses qualified public tables.
    return (
        re.sub(r"\s+", "", sql).replace('"', "").replace("public.", "").replace("unnest(items)", "unnest($1::jsonb[])")
    )


class QueryOnly:
    """No execute method; data queries are bounded SELECT/SELECT-EXPLAIN only."""

    def __init__(self, connection: Any, report: dict[str, Any]) -> None:
        self.connection = connection
        self.report = report
        self.count = 0

    async def fetch(self, sql: str, *args: Any) -> list[Any]:
        assert sql.lstrip().startswith(("SELECT ", "EXPLAIN (")), "NON_READ_QUERY_REFUSED"
        assert ";" not in sql and not re.search(
            r"\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|CALL|COPY|SET|DO|GRANT|TRUNCATE|pg_sleep|pg_advisory_lock)\b",
            sql,
            re.IGNORECASE,
        ), "NON_READ_QUERY_REFUSED"
        self.count += 1
        assert self.count <= MAX_QUERIES, "QUERY_COUNT_LIMIT"
        started = time.perf_counter()
        try:
            return list(await self.connection.fetch(sql, *args, timeout=QUERY_SECONDS))
        finally:
            self.report.setdefault("queries", []).append(
                {"number": self.count, "sql": sql, "milliseconds": (time.perf_counter() - started) * 1000}
            )


async def inspect_catalog(query: QueryOnly, report: dict[str, Any]) -> None:
    names = [*ASSOCIATIONS, *ENDPOINTS]
    functions = await query.fetch(
        "SELECT p.proname,p.oid::text AS oid,pg_get_function_identity_arguments(p.oid) AS arguments,"
        "pg_get_functiondef(p.oid) AS definition,p.proconfig FROM pg_proc p "
        "JOIN pg_namespace n ON n.oid=p.pronamespace "
        "WHERE n.nspname=$1 AND p.proname=ANY($2::text[]) ORDER BY p.proname,p.oid",
        SCHEMA,
        list(FUNCTIONS),
    )
    report["functions"] = [dict(row) for row in functions]
    assert {row["proname"] for row in functions} == set(FUNCTIONS), "MISSING_STORED_GUARD"
    association = [row for row in functions if row["proname"] == "guard_transition_association_write"]
    assert len(association) == 1, "AMBIGUOUS_STORED_GUARD"
    match = re.search(
        r"FOR\s+target_bank\s+IN\s+(SELECT.*?)\s+LOOP\s+PERFORM", association[0]["definition"], re.I | re.S
    )
    assert match is not None, "UNREVIEWED_ASSOCIATION_BODY"
    assert normalized_lookup(match[1]) == normalized_lookup(endpoint_query(native_uuid=False)), (
        "UNREVIEWED_ENDPOINT_LOOKUP"
    )
    report["storedEndpointLookupMatchesReviewedTextPredicate"] = True
    triggers = await query.fetch(
        "SELECT c.relname,t.tgname,t.tgenabled,p.proname,pg_get_triggerdef(t.oid,true) AS definition "
        "FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) "
        "AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
        SCHEMA,
        list(ASSOCIATIONS),
    )
    report["triggers"] = [dict(row) for row in triggers]
    guards = [row for row in triggers if row["proname"] == "guard_transition_association_write"]
    assert {row["relname"] for row in guards} == set(ASSOCIATIONS), "MISSING_ASSOCIATION_TRIGGER"
    assert all(row["tgenabled"] in {"O", "A"} and "FOR EACH ROW" in row["definition"] for row in guards), (
        "INACTIVE_ASSOCIATION_TRIGGER"
    )
    columns = await query.fetch(
        "SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull "
        "FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped "
        "ORDER BY c.relname,a.attnum",
        SCHEMA,
        names,
    )
    report["columns"] = [dict(row) for row in columns]
    types = {(row["relname"], row["attname"]): row["type"] for row in columns}
    required = [(name, "id") for name in ENDPOINTS] + [
        ("memory_links", "from_unit_id"),
        ("memory_links", "to_unit_id"),
        ("unit_entities", "unit_id"),
        ("unit_entities", "entity_id"),
        ("entity_cooccurrences", "entity_id_1"),
        ("entity_cooccurrences", "entity_id_2"),
    ]
    assert all(types.get(key) == "uuid" for key in required), "NON_UUID_ENDPOINT_COLUMN"
    if ("memory_links", "entity_id") in types:
        assert types[("memory_links", "entity_id")] == "uuid", "NON_UUID_OPTIONAL_ENTITY_COLUMN"
    report["indexes"] = [
        dict(row)
        for row in await query.fetch(
            "SELECT t.relname,i.relname AS index_name,x.indisvalid,x.indisready,pg_get_indexdef(i.oid) AS definition "
            "FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid "
            "JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=ANY($2::text[]) "
            "ORDER BY t.relname,i.relname",
            SCHEMA,
            names,
        )
    ]
    report["tableEstimates"] = [
        dict(row)
        for row in await query.fetch(
            "SELECT c.relname,c.reltuples::bigint AS estimated_rows,c.relpages,pg_total_relation_size(c.oid) AS bytes "
            "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 "
            "AND c.relname=ANY($2::text[]) ORDER BY c.relname",
            SCHEMA,
            names,
        )
    ]


async def cases_from_available_rows(query: QueryOnly, transition: uuid.UUID, report: dict[str, Any]) -> list[dict]:
    owners = await query.fetch(
        f"SELECT bank_id FROM {table('memory_transition_requests')} WHERE transition_id=$1 ORDER BY bank_id", transition
    )
    assert len(owners) == 1, "AMBIGUOUS_DIAGNOSTIC_BANK"
    bank = owners[0]["bank_id"]
    samples = {}
    for name in ENDPOINTS:
        samples[name] = [
            dict(row)
            for row in await query.fetch(
                f"SELECT id,bank_id FROM {table(name)} WHERE bank_id=$1 ORDER BY id LIMIT 2", bank
            )
        ]
    report["availableEndpoints"] = {name: len(rows) for name, rows in samples.items()}
    missing = uuid.uuid4()
    for name in ENDPOINTS:
        assert not await query.fetch(f"SELECT id FROM {table(name)} WHERE id=$1", missing), "MISSING_ENDPOINT_COLLISION"
    foreign = await query.fetch(
        f"SELECT bank_id FROM {table('banks')} WHERE bank_id<>$1 ORDER BY bank_id LIMIT 1", bank
    )
    mislabeled = foreign[0]["bank_id"] if foreign else f"owned-missing-bank-{uuid.uuid4().hex}"
    if not foreign:
        assert not await query.fetch(f"SELECT bank_id FROM {table('banks')} WHERE bank_id=$1", mislabeled)
    cases = []

    def add(name: str, items: list[dict], *, synthetic: bool = False) -> None:
        assert len(items) in {1, 2}
        cases.append({"name": name, "items": items, "syntheticInputOnly": synthetic})

    # Mirror every field read by the stored trigger, including optional direct
    # ownership or legacy entity endpoints. Missing fields become JSON null;
    # no unrelated row payload is transported into the diagnostic cases.
    fields = ("bank_id", "unit_id", "from_unit_id", "to_unit_id", "entity_id", "entity_id_1", "entity_id_2")
    projection = (
        "jsonb_build_object(" + ",".join(f"'{field}',to_jsonb(a)->'{field}'" for field in fields) + ")::text AS body"
    )
    statements = {
        "memory_links": (
            f"SELECT {projection} FROM {table('memory_links')} a WHERE a.bank_id=$1 "
            "ORDER BY a.from_unit_id,a.to_unit_id,a.link_type LIMIT 2"
        ),
        "unit_entities": (
            f"SELECT {projection} FROM {table('unit_entities')} a JOIN {table('memory_units')} m ON m.id=a.unit_id "
            "WHERE m.bank_id=$1 ORDER BY a.unit_id,a.entity_id LIMIT 2"
        ),
        "entity_cooccurrences": (
            f"SELECT {projection} FROM {table('entity_cooccurrences')} a "
            f"JOIN {table('entities')} e ON e.id=a.entity_id_1 "
            "WHERE e.bank_id=$1 ORDER BY a.entity_id_1,a.entity_id_2 LIMIT 2"
        ),
    }
    report["missingAssociationSamples"] = []
    for name, sql in statements.items():
        rows = [json.loads(row["body"]) for row in await query.fetch(sql, bank)]
        if rows:
            # INSERT and DELETE each feed one NEW/OLD row; UPDATE feeds both.
            add(f"{name}:single-old-or-new", [rows[0]])
            add(f"{name}:old-and-new", [rows[0], rows[-1]])
        else:
            report["missingAssociationSamples"].append(name)
    empty = str(missing)
    add(
        "memory_links:missing-endpoints",
        [{"bank_id": bank, "from_unit_id": empty, "to_unit_id": empty}],
        synthetic=True,
    )
    add("unit_entities:missing-endpoints", [{"unit_id": empty, "entity_id": empty}], synthetic=True)
    add("entity_cooccurrences:missing-endpoints", [{"entity_id_1": empty, "entity_id_2": empty}], synthetic=True)
    live = samples["memory_units"]
    archive = samples["invalidated_memory_units"]
    entities = samples["entities"]
    if live:
        add(
            "memory_links:mislabeled-bank",
            [{"bank_id": mislabeled, "from_unit_id": str(live[0]["id"]), "to_unit_id": str(live[-1]["id"])}],
            synthetic=True,
        )
    if archive:
        add(
            "memory_links:archived-endpoint",
            [
                {
                    "bank_id": bank,
                    "from_unit_id": str(archive[0]["id"]),
                    "to_unit_id": str(live[0]["id"]) if live else empty,
                }
            ],
            synthetic=True,
        )
        add(
            "unit_entities:archived-endpoint",
            [{"unit_id": str(archive[0]["id"]), "entity_id": str(entities[0]["id"]) if entities else empty}],
            synthetic=True,
        )
    assert len(cases) <= MAX_CASES
    report["mislabeledBankUsesExistingForeignBank"] = bool(foreign)
    return cases


async def query_clone(clone: Any) -> None:
    import asyncpg

    clone.connection_refusal_guard()
    connection = await asyncpg.connect(
        host="127.0.0.1",
        port=clone.PORT,
        database="taki_real",
        user="taki_real",
        timeout=10,
        command_timeout=QUERY_SECONDS,
        server_settings={
            "default_transaction_read_only": "on",
            "statement_timeout": "10000",
            "lock_timeout": "2000",
            "idle_in_transaction_session_timeout": "60000",
            "search_path": "pg_catalog,public",
            "application_name": "w5-trigger-readonly-diagnostic",
        },
    )
    try:
        query = QueryOnly(connection, clone.REPORT)
        async with connection.transaction(isolation="repeatable_read", readonly=True):
            settings = (
                await query.fetch(
                    "SELECT current_setting('data_directory') AS data_directory,"
                    "current_setting('transaction_read_only') AS readonly,"
                    "current_setting('transaction_isolation') AS isolation,"
                    "current_setting('statement_timeout') AS statement_timeout,"
                    "current_setting('server_version') AS version"
                )
            )[0]
            assert Path(settings["data_directory"]).resolve() == (clone.CLONE / "data").resolve(), (
                "WRONG_DATA_DIRECTORY"
            )
            assert settings["readonly"] == "on" and settings["isolation"] == "repeatable read", "WRONG_TRANSACTION_MODE"
            clone.REPORT["transaction"] = dict(settings)
            await inspect_catalog(query, clone.REPORT)
            cases = await cases_from_available_rows(query, clone.TRANSITION, clone.REPORT)
            clone.REPORT["cases"] = []
            for case in cases:
                # Only canonical UUID strings generated from UUID columns (or
                # a checked missing UUID) enter the candidate's RHS casts.
                encoded = [json.dumps(item, sort_keys=True) for item in case["items"]]
                result = {key: value for key, value in case.items() if key != "items"}
                result["inputSha256"] = hashlib.sha256(json.dumps(encoded).encode()).hexdigest()
                for native, label in ((False, "textPredicate"), (True, "uuidPredicate")):
                    sql = endpoint_query(native_uuid=native)
                    banks = [row["bank_id"] for row in await query.fetch(sql, encoded)]
                    plan = await query.fetch(
                        "EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING OFF, FORMAT JSON) " + sql, encoded
                    )
                    raw = plan[0][0]
                    result[label] = {"banks": banks, "plan": json.loads(raw) if isinstance(raw, str) else raw}
                result["sameBankSet"] = result["textPredicate"]["banks"] == result["uuidPredicate"]["banks"]
                clone.REPORT["cases"].append(result)
                assert result["sameBankSet"], "ENDPOINT_BANK_SET_CHANGED"
            clone.REPORT["allBankSetsEquivalent"] = True
            clone.REPORT["queryCount"] = query.count
            clone.REPORT["diagnosticCompleted"] = True
    finally:
        try:
            await asyncio.wait_for(connection.close(), timeout=5)
        except TimeoutError:
            connection.terminate()
            raise


def run_reviewed() -> None:
    verify_sources()
    spec = importlib.util.spec_from_file_location(
        "w5_readonly_clone_custody", HERE / "w5-reentry-candidate-native-clone.py"
    )
    assert spec is not None and spec.loader is not None
    clone = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = clone
    spec.loader.exec_module(clone)
    clone.REPORT = {
        "meaning": (
            "Parent-only read-only trigger/endpoint SELECT diagnostic on one fresh physical clone; "
            "not a full-apply benchmark or fencing acceptance."
        ),
        "networkAttemptsRefused": 0,
        "realModelCalls": 0,
        "applyCalls": 0,
        "stopped": False,
        "limits": {
            "totalSqlSeconds": TOTAL_SECONDS,
            "perQuerySeconds": QUERY_SECONDS,
            "maxQueries": MAX_QUERIES,
            "maxCases": MAX_CASES,
        },
        "readerManifestSha256": READER_HASH,
        "namespace": SCHEMA,
        "authentication": (
            "Clone-only loopback HBA trust; no source credentials read and no ALTER ROLE/password mutation."
        ),
    }
    original_pg_command = clone.pg_command

    def readonly_pg_command(arguments: list[str], label: str, timeout: int = 45) -> int:
        arguments = list(arguments)
        assert arguments[-1] in {"start", "stop"}, "UNREVIEWED_PG_COMMAND"
        if arguments[-1] == "start":
            assert clone.PORT not in {3753, 18495, 18496}, "PORT_SCOPE_CONFLICT"
            index = arguments.index("-o") + 1
            arguments[index] += " -c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000"
        return original_pg_command(arguments, label, timeout=timeout)

    async def readonly_run(_unused_password: str) -> None:
        await asyncio.wait_for(query_clone(clone), timeout=TOTAL_SECONDS)

    # Reuse only the reviewed clone lifecycle/custody. Replacing this callback
    # prevents every original bootstrap password change, claim and apply path.
    clone.pg_command = readonly_pg_command
    clone.run_clone = readonly_run
    try:
        clone.main()
    finally:
        clone.REPORT["readerSourcesPreserved"] = False
        clone.REPORT["portReleased"] = False
        try:
            verify_sources()
            clone.REPORT["readerSourcesPreserved"] = True
            # An absent PID file is the inherited stop proof. Also positively
            # reserve the owned port again; never stop an unrelated listener.
            if clone.PORT is not None and clone.REPORT["stopped"]:
                with socket.socket() as reservation:
                    reservation.bind(("127.0.0.1", clone.PORT))
                clone.REPORT["portReleased"] = True
        finally:
            if clone.CLONE is not None:
                clone.write_json(clone.CLONE / "result.json", clone.REPORT)
    assert clone.REPORT["diagnosticCompleted"] and clone.REPORT["allBankSetsEquivalent"]
    assert clone.REPORT["stopped"] and clone.REPORT["originalPreserved"] and clone.REPORT["portReleased"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true", help="Parent only, after source review.")
    args = parser.parse_args()
    if not args.run_reviewed_clone:
        print(
            json.dumps(
                {
                    "parentRunOnly": True,
                    "executed": False,
                    "totalSqlSeconds": TOTAL_SECONDS,
                    "perQuerySeconds": QUERY_SECONDS,
                    "scope": "Stored trigger/index/type metadata and endpoint SELECT EXPLAIN; no apply or writes.",
                }
            )
        )
        return
    run_reviewed()


if __name__ == "__main__":
    main()
