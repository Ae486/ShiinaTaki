"""Scheduled red reproduction: remove only B3's two guards, retain evidence, restore exact source bytes."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
TAKI = HERE.parents[3]
NATIVE = Path("H:/hindsight").resolve()
PYTHON = NATIVE / ".venv/Scripts/python.exe"
GUARDS = {
    "hindsight-api-slim/hindsight_api/api/taki_backup.py": '''        except Exception:
            # A v2 SQL/filesystem/observer failure must not expose operational
            # rows, resolver details or connection information in a traceback.
            # Preserve the historical v1 exception behavior at this boundary.
            if isinstance(backup_request, TakiBackupRequestV2):
                return backup_refusal_response("operation_refused")
            raise
''',
    "hindsight-api-slim/hindsight_api/admin/cli.py": '''    except Exception:
        # Typer's ordinary exception renderer can include locals. Keep v2
        # infrastructure failures bounded and omit SQL, config and secrets.
        if isinstance(request, TakiBackupRequestV2):
            typer.echo("Error: Taki backup refused: operation_refused", err=True)
            raise typer.Exit(1) from None
        raise
''',
}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def main() -> None:
    destination = HERE / "b3-native-exception-red-01-patch.json"
    if destination.exists():
        raise ValueError("The red evidence already exists")
    sources = {}
    changes = []
    for relative, text in GUARDS.items():
        path = (NATIVE / relative).resolve()
        if not path.is_relative_to(NATIVE):
            raise ValueError("Source escaped Native root")
        original = path.read_bytes()
        candidates = [text.encode(), text.replace("\n", "\r\n").encode()]
        matching = [value for value in candidates if original.count(value) == 1]
        if len(matching) != 1:
            raise ValueError(f"The exact new guard is not unique: {relative}")
        removed = matching[0]
        red = original.replace(removed, b"", 1)
        sources[path] = (original, red)
        changes.append({"path": relative, "greenSha256": digest(original), "redSha256": digest(red),
                        "removedGuard": removed.decode(), "restored": False})
    with destination.open("x", encoding="utf-8") as stream:
        json.dump({"changes": changes}, stream, indent=2)
        stream.write("\n")
    result = None
    try:
        for path, (_, red) in sources.items():
            path.write_bytes(red)
        command = [str(PYTHON), str(HERE / "run-b3-native-check.py"), "exception-red-01", str(TAKI),
                   str(PYTHON), str(TAKI / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py"),
                   "--allow-http-fixture", "--",
                   "tests/native_results/test_template_backup_transport.py::test_v2_copy_failure_is_sanitized_by_route_and_cli",
                   "-q", "--tb=short"]
        result = subprocess.run(command, cwd=TAKI, stdin=subprocess.DEVNULL, check=False,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    finally:
        for change, (path, (original, red)) in zip(changes, sources.items(), strict=True):
            if path.read_bytes() != red:
                raise RuntimeError(f"Unexpected source change during exclusive red run: {path}")
            path.write_bytes(original)
            change["restored"] = path.read_bytes() == original
        destination.write_text(json.dumps({"changes": changes, "redExitCode": result.returncode if result else None}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patchEvidence": str(destination), "allRestored": all(item["restored"] for item in changes),
                      "redExitCode": result.returncode}))
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
