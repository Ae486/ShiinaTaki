"""Task-only cached-image inventory; stdin entrypoint, no package/runtime startup.

Read pg0's installed inventory and source without importing it. Missing raw PG
assets remain prerequisites; this probe never invokes pg0's extraction/fallbacks.
"""

import hashlib
import json
import os
import selectors
import signal
import stat
import subprocess
import sys
import sysconfig
import time
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path

SEED = Path("/home/hindsight/.pg0")
PG_NAMES = {"postgres", "initdb", "pg_ctl", "pg_controldata"}
OUTPUT_LIMIT = 128 * 1024
started = time.monotonic()
hashed_bytes = 0
result = {"scope": "cached-image-metadata-only", "unresolved": []}


def bounded(condition, reason):
    if not condition:
        raise ValueError(reason)


def deadline(_signal, _frame):
    # Do not let a utility's local timeout handler consume the whole-probe alarm.
    raise InterruptedError("probe_deadline")


def facts(path):
    """lstat plus effective-UID access; never follow a leaf symlink for content."""
    item = {"path": str(path), "exists": False}
    try:
        info = path.lstat()
    except FileNotFoundError:
        return item
    item.update(
        exists=True,
        uid=info.st_uid,
        gid=info.st_gid,
        mode=oct(stat.S_IMODE(info.st_mode)),
        bytes=info.st_size,
        regular=stat.S_ISREG(info.st_mode),
        directory=stat.S_ISDIR(info.st_mode),
        symlink=stat.S_ISLNK(info.st_mode),
        readable=os.access(path, os.R_OK, effective_ids=True),
        executable_or_traversable=os.access(path, os.X_OK, effective_ids=True),
    )
    return item


def digest(path, limit=512 * 1024 * 1024):
    global hashed_bytes
    bounded(path.stat().st_size <= limit, "file_hash_limit")
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            hashed_bytes += len(chunk)
            bounded(hashed_bytes <= 768 * 1024 * 1024, "total_hash_limit")
            value.update(chunk)
    return value.hexdigest()


def package(name):
    try:
        installed = distribution(name)
    except PackageNotFoundError:
        result["unresolved"].append(name + ":missing_distribution")
        return None, []
    files = installed.files or []
    bounded(len(files) <= 4096, "package_file_count_limit")
    bounded(sum(len(str(entry)) for entry in files) <= 256 * 1024, "package_path_limit")
    details = {
        "name": name,
        "version": installed.version,
        "root": str(installed.locate_file("")),
        "listed_files": len(files),
        "metadata": [],
    }
    for entry in files:
        if entry.name not in {"METADATA", "WHEEL", "RECORD"}:
            continue
        path = Path(installed.locate_file(entry))
        item = facts(path)
        if item.get("regular") and item["readable"]:
            item["sha256"] = digest(path, 256 * 1024)
        details["metadata"].append(item)
    return details, files


def source_evidence(path):
    """Return numbered source lines as evidence, without executing its defaults."""
    bounded(path.stat().st_size <= 64 * 1024, "source_size_limit")
    lines = path.read_text(encoding="utf-8").splitlines()
    needles = (
        "HOME",
        "Path.home",
        "data_dir",
        "data-dir",
        "bundled",
        "package_dir",
        "binary_name",
        "binary_path",
        "subprocess",
        "capture_output",
        "check=False",
        "password",
        "shutil.which",
        "download",
        "extract",
        "def stop",
        "def start",
    )
    selected = set()
    for index, line in enumerate(lines):
        if any(needle in line for needle in needles):
            selected.update(range(max(0, index - 1), min(len(lines), index + 2)))
    excerpt = [{"line": index + 1, "text": lines[index]} for index in sorted(selected)]
    bounded(len(json.dumps(excerpt)) <= 24 * 1024, "source_excerpt_limit")
    return excerpt


def version_only(path):
    """One existing ELF, one --version argument, 3 seconds and 4 KiB total output."""
    env = {"HOME": "/home/hindsight", "LANG": "C", "LC_ALL": "C"}
    before = time.monotonic()
    output = bytearray()
    report = {"argv": [str(path), "--version"], "environment": env}
    process = subprocess.Popen(
        report["argv"],
        env=env,
        cwd="/",
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        close_fds=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = 3 - (time.monotonic() - before)
                if remaining <= 0:
                    raise TimeoutError("version_deadline")
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fd, 4097 - len(output))
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    output.extend(chunk)
                    bounded(len(output) <= 4096, "version_output_limit")
            report["exit_code"] = process.wait(timeout=max(0.01, 3 - (time.monotonic() - before)))
    except (TimeoutError, subprocess.TimeoutExpired, ValueError) as error:
        report["error"] = type(error).__name__
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=1)
        process.stdout.close()
    report.update(
        output=output[:4096].decode("utf-8", errors="replace"),
        elapsed_seconds=round(time.monotonic() - before, 3),
    )
    return report


def inspect():
    bounded(sys.platform == "linux" and os.geteuid() == os.getegid() == 1000, "linux_uid_required")
    purelib = Path(sysconfig.get_path("purelib"))
    bounded(str(purelib).startswith("/app/api/.venv/lib/"), "fixed_venv_required")
    result["runtime"] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "uid": os.geteuid(),
        "gid": os.getegid(),
        "purelib": str(purelib),
        "home_environment": os.environ.get("HOME"),
        "python_home": str(Path.home()),
        "consumer_home": str(SEED),
        "consumer_home_dot_pg0_candidate": str(SEED / ".pg0"),
        "data_directory_behavior": (
            "Review numbered source; CLI defaults and SQL data_directory are not established."
        ),
    }
    result["seed"] = facts(SEED)
    result["seed"]["parents"] = [facts(path) for path in reversed(SEED.parents)]
    if result["seed"].get("directory"):
        with os.scandir(SEED) as entries:
            seed_entries = []
            for entry in entries:
                bounded(len(seed_entries) < 32, "seed_entry_limit")
                seed_entries.append(facts(Path(entry.path)))
        result["seed"].update(empty=not seed_entries, entries=seed_entries)
        if seed_entries:
            result["unresolved"].append(
                "nonempty_seed_requires_explicit_asset_paths; contents_not_read"
            )
    else:
        result["unresolved"].append("missing_or_non_directory_seed")

    pg0, files = package("pg0-embedded")
    sql, _ = package("psycopg2-binary")
    result["packages"] = {"pg0": pg0, "sql_client": sql}
    result["assets"] = []
    result["postgres_versions"] = []
    found = set()
    for entry in files:
        # Only package-listed pg0 assets; no cache walk, PATH lookup or model scan.
        path = Path(pg0["root"]) / entry
        bounded(len(str(path)) <= 1024, "asset_path_limit")
        resolved = path.resolve()
        allowed = resolved.is_relative_to(purelib / "pg0") or resolved == Path(
            "/app/api/.venv/bin/pg0"
        )
        if not allowed or "__pycache__" in path.parts:
            continue
        bounded(len(result["assets"]) < 32, "asset_count_limit")
        item = facts(path)
        item["resolved_path"] = str(resolved)
        item["parents"] = [facts(parent) for parent in reversed(resolved.parents)]
        result["assets"].append(item)
        if not item.get("regular") or not item["readable"]:
            result["unresolved"].append("unreadable_or_nonregular_asset:" + str(path))
            continue
        item["sha256"] = digest(path)
        if path.suffix == ".py":
            item["source_lines"] = source_evidence(path)
        if path.name not in PG_NAMES or path.name in found or not item["executable_or_traversable"]:
            continue
        with path.open("rb") as stream:
            is_elf = stream.read(4) == b"\x7fELF"
        item["elf"] = is_elf
        if is_elf:
            found.add(path.name)
            version = version_only(resolved)
            result["postgres_versions"].append(version)
            if version.get("exit_code") != 0:
                result["unresolved"].append("version_or_loader_failure:" + path.name)
    for name in sorted(PG_NAMES - found):
        result["unresolved"].append("raw_asset_not_confirmed:" + name)
    if PG_NAMES - found:
        result["asset_prerequisite"] = (
            "Missing or extraction-only PostgreSQL layout; freeze an offline "
            "extraction/start proposal before further effects."
        )
    result["acceptance"] = (
        "Inventory only; no SQL readiness, process ownership, shutdown, "
        "persistence or managed deployment acceptance."
    )


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(50)
    try:
        inspect()
    except (OSError, ValueError, TimeoutError) as error:
        result["unresolved"].append("probe_incomplete:" + type(error).__name__)
    finally:
        signal.alarm(0)
    result["status"] = "unresolved_prerequisite" if result["unresolved"] else "inventory_complete"
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    result["hashed_bytes"] = hashed_bytes
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("ascii")
    if len(encoded) + 1 > OUTPUT_LIMIT:
        encoded = (
            b'{"status":"unresolved_prerequisite","unresolved":["output_limit"],'
            b'"evidence_complete":false}'
        )
    sys.stdout.buffer.write(encoded + b"\n")
