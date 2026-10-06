"""Pure source/captured-SQL audit; no database, engine, clone or model execution."""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
NATIVE = Path("H:/hindsight/hindsight-api-slim")
OLD = NATIVE / "hindsight_api/alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py"
NEW = NATIVE / "hindsight_api/alembic/versions/e40b1e8a7d32_optimize_transition_association_lookup.py"


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def normalized(sql: str) -> str:
    return re.sub(r"\s+", "", sql)


def main() -> None:
    sys.path.insert(0, str(NATIVE))
    assert (
        hashlib.sha256(OLD.read_bytes()).hexdigest()
        == "3a310b19a4e6de34a0a9eb7935992105f90df21a0717e96fd6aad9834f9e6433"
    )
    expressions = [
        node
        for node in ast.walk(ast.parse(OLD.read_text(encoding="utf-8")))
        if isinstance(node, ast.JoinedStr) and "guard_transition_association_write() RETURNS" in ast.unparse(node)
    ]
    assert len(expressions) == 1
    migration = load("w5_uuid_migration_audit", NEW)
    rehearsal = load("w5_uuid_rehearsal_audit", ROOT / "w5-trigger-uuid-migration-rehearsal.py")
    assert migration.revision == "e40b1e8a7d32" and migration.down_revision == "e30a9d7f6c21"
    for schema in (None, "public", "assoc_tenant"):
        prefix = f'"{schema}".' if schema else ""
        historical = eval(compile(ast.Expression(expressions[0]), str(OLD), "eval"), {"schema": prefix})
        captured = []
        migration.context = SimpleNamespace(config=SimpleNamespace(get_main_option=lambda _name: schema))
        migration.op = SimpleNamespace(execute=captured.append)
        migration._pg_upgrade()
        migration._pg_downgrade()
        assert len(captured) == 2
        expected = rehearsal.expected_function(historical).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")
        assert normalized(captured[0]) == normalized(expected), "UNREVIEWED_UPGRADE_SQL"
        assert normalized(captured[1].replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")) == normalized(
            historical
        )
    # Exercise the actual parent wrapper's Alembic configuration without opening
    # any connection. Only command.upgrade is replaced by a capturing callback.
    from alembic import command
    from alembic.config import Config
    from sqlalchemy.engine import make_url

    captured_config = []

    def capture_upgrade(config: Config, revision: str, sql: bool = False, tag: str | None = None) -> None:
        assert not sql and tag is None
        captured_config.append((config, revision))

    with patch.object(command, "upgrade", side_effect=capture_upgrade):
        rehearsal.upgrade_once(SimpleNamespace(PORT=32123, owned_pg=lambda: True))
    assert len(captured_config) == 1
    config, revision = captured_config[0]
    url = make_url(config.get_main_option("sqlalchemy.url"))
    assert (url.host, url.port, url.database, url.username, url.password) == (
        "127.0.0.1",
        32123,
        "taki_real",
        "taki_real",
        None,
    )
    assert url.query["connect_timeout"] == "10"
    assert url.query["options"] == "-c statement_timeout=10000 -c lock_timeout=2000"
    assert revision == "e40b1e8a7d32" and config.get_main_option("target_schema") == "public"
    result = {
        "historicalMigrationUnchanged": True,
        "schemas": ["default", "public", "assoc_tenant"],
        "onlyApprovedPredicatesChanged": True,
        "downgradeRestoresHistoricalBody": True,
        "oneStatementPerDirection": True,
        "parentHelperExactAlembicConfig": True,
        "databaseAccess": False,
        "cloneRun": False,
    }
    (ROOT / "w5-trigger-uuid-source-audit.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
