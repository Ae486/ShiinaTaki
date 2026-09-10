"""Run the repository's pinned client generators without starting Docker on Windows.

Only explicit command-line selections write generated files. The OpenAPI entry point,
generator arguments and source postprocessors remain the maintained Hindsight ones.
Owned temporary output and logs stay below the task's ignored runtime directory.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from run_isolated_hindsight import HINDSIGHT_ROOT, PYTHON, TAKI_ROOT, clean_environment


TOOL_ROOT = TAKI_ROOT / ".trellis/.runtime/g1-toolchain"
JAVA = TOOL_ROOT / "jre/jdk-17.0.20.1+1-jre/bin/java.exe"
GENERATOR = TOOL_ROOT / "openapi-generator-cli-7.10.0.jar"
GO = TOOL_ROOT / "go/go/bin/go.exe"
CLIENTS = HINDSIGHT_ROOT / "hindsight-clients"
SPEC = HINDSIGHT_ROOT / "hindsight-docs/static/openapi.json"


def checked_path(path: Path, root: Path) -> Path:
    """Resolve before any write/removal so a junction cannot redirect generated output."""
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise RuntimeError(f"Generated path is outside its owned directory: {path}")
    return resolved


def mirror_generated_tree(source: Path, target: Path) -> None:
    """Mirror a generator-owned subtree; never touch maintained wrappers or manifests."""
    checked_path(target, CLIENTS)
    incoming = {path.relative_to(source): path for path in source.rglob("*") if path.is_file()}
    if not incoming:
        raise RuntimeError(f"Generator produced no files: {source}")
    if target.exists():
        for previous in target.rglob("*"):
            checked_path(previous, target)
            if previous.is_file() and previous.relative_to(target) not in incoming:
                previous.unlink()
    for relative, path in incoming.items():
        destination = checked_path(target / relative, target)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)


def normalize_generated_text(root: Path, suffix: str) -> None:
    """Apply generate-clients.sh's normalization to precisely the same source scopes."""
    for path in root.rglob(f"*{suffix}"):
        content = path.read_text(encoding="utf-8")
        normalized = "\n".join(line.rstrip(" \t\r") for line in content.splitlines()).rstrip("\n") + "\n"
        path.write_text(normalized, encoding="utf-8", newline="\n")


class GeneratorRun:
    def __init__(self) -> None:
        self.root = TAKI_ROOT / ".trellis/.runtime/g1-codegen" / uuid.uuid4().hex[:12]
        self.root.mkdir(parents=True)
        self.env = clean_environment()
        self.env["PYTHONPATH"] += os.pathsep + str(HINDSIGHT_ROOT / "hindsight-dev")
        self.env.update(
            {
                "GOTOOLCHAIN": "local",
                "GOPATH": str(TOOL_ROOT / "go-work"),
                "GOMODCACHE": str(TOOL_ROOT / "go-modules"),
                "GOCACHE": str(TOOL_ROOT / "go-build"),
                "npm_config_offline": "true",
                "npm_config_audit": "false",
                "npm_config_fund": "false",
            }
        )
        self.script = (HINDSIGHT_ROOT / "scripts/generate-clients.sh").read_text(encoding="utf-8")
        if 'OPENAPI_GENERATOR_VERSION="v7.10.0"' not in self.script:
            raise RuntimeError("The maintained generator pin changed; refresh this task's toolchain first")
        self.postprocessors = re.findall(r"python3 << PATCH_SCRIPT\n(.*?)\nPATCH_SCRIPT", self.script, re.DOTALL)
        if len(self.postprocessors) != 2:
            raise RuntimeError("Maintained generator postprocessors changed; review before proceeding")
        print("Codegen logs:", self.root, flush=True)

    def run(self, label: str, command: list[str], cwd: Path, *, allow_generator_readme_error: bool = False) -> None:
        log_path = self.root / f"{label}.log"
        with log_path.open("w", encoding="utf-8") as log:
            result = subprocess.run(
                command,
                cwd=cwd,
                env=self.env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
        output = log_path.read_text(encoding="utf-8", errors="replace")
        print(f"{label}: exit {result.returncode}; {log_path}", flush=True)
        if result.returncode and not (allow_generator_readme_error and "README_onlypackage.mustache" in output):
            print("\n".join(output.splitlines()[-45:]), flush=True)
            raise RuntimeError(f"{label} failed")

    def openapi(self) -> None:
        # No API lifecycle runs: the canonical entry builds app.openapi() with db_url='mock'.
        self.run(
            "openapi",
            [
                str(PYTHON),
                "-c",
                (
                    "import os; os.environ['TAKI_G1_FIXTURE_PORT'] = '0'; "
                    "from g1_fixture_network_guard import pytest_sessionstart; pytest_sessionstart(None); "
                    "from hindsight_dev.generate_openapi import generate_openapi_spec; generate_openapi_spec()"
                ),
            ],
            HINDSIGHT_ROOT / "hindsight-dev",
        )
        schema = json.loads(SPEC.read_text(encoding="utf-8"))
        if not schema.get("paths") or not schema.get("components"):
            raise RuntimeError("Canonical OpenAPI entry returned an incomplete schema")

    def python(self) -> None:
        target = CLIENTS / "python"
        stage = self.root / "python"
        self.run(
            "python-generator",
            [
                str(JAVA),
                "-Dfile.encoding=UTF-8",
                "-jar",
                str(GENERATOR),
                "generate",
                "-i",
                SPEC.relative_to(HINDSIGHT_ROOT).as_posix(),
                "-g",
                "python",
                "-o",
                str(stage),
                "-c",
                str(target / "openapi-generator-config.yaml"),
            ],
            HINDSIGHT_ROOT,
            allow_generator_readme_error=True,
        )
        package = stage / "hindsight_client_api"
        for required in ("api_client.py", "rest.py", "configuration.py", "api/__init__.py", "models/__init__.py"):
            if not (package / required).is_file():
                raise RuntimeError(f"Incomplete generated Python package: {required}")
        # Execute the actual maintained patch instead of maintaining a second copy of its replacement text.
        patch = self.postprocessors[0].replace("$PYTHON_CLIENT_DIR", stage.as_posix())
        self.run("python-postprocess", [str(PYTHON), "-c", patch], HINDSIGHT_ROOT)
        if "def _ensure_session(self)" not in (package / "rest.py").read_text(encoding="utf-8"):
            raise RuntimeError("Canonical Python lazy-session postprocessor did not apply")
        for subtree in ("api", "models"):
            normalize_generated_text(package / subtree, ".py")
        (package / "py.typed").touch()
        mirror_generated_tree(package, target / "hindsight_client_api")
        mirror_generated_tree(stage / ".openapi-generator", target / ".openapi-generator")

    def typescript(self) -> None:
        target = CLIENTS / "typescript"
        # Match the canonical fresh generation without discarding the previous tree.
        # Both absolute paths are checked before the directory rename.
        previous = checked_path(target / "generated", CLIENTS)
        backup = checked_path(self.root / "typescript-before", self.root)
        if previous.exists():
            previous.rename(backup)
        self.run(
            "typescript-generator",
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "& npm.cmd run generate"],
            target,
        )
        patch = self.postprocessors[1].replace("$TYPESCRIPT_CLIENT_DIR", target.as_posix())
        self.run("typescript-postprocess", [str(PYTHON), "-c", patch], HINDSIGHT_ROOT)
        if "...optsForRequest" not in (target / "generated/client/client.gen.ts").read_text(encoding="utf-8"):
            raise RuntimeError("Canonical TypeScript Deno postprocessor did not apply")

    def go(self) -> None:
        target = CLIENTS / "go"
        stage = self.root / "go"
        self.run(
            "go-generator",
            [
                str(JAVA),
                "-Dfile.encoding=UTF-8",
                "-jar",
                str(GENERATOR),
                "generate",
                "-i",
                SPEC.relative_to(HINDSIGHT_ROOT).as_posix(),
                "-g",
                "go",
                "-o",
                str(stage),
                "--package-name",
                "hindsight",
                "--git-user-id",
                "vectorize-io",
                "--git-repo-id",
                "hindsight/hindsight-clients/go",
                "--type-mappings",
                "integer=int64",
                "--additional-properties",
                "useOneOfDiscriminatorLookup=true",
                "--global-property",
                "apiDocs=false,apiTests=false,modelDocs=false,modelTests=false",
            ],
            HINDSIGHT_ROOT,
        )
        files_api = stage / "api_files.go"
        if files_api.is_file():
            content = files_api.read_text(encoding="utf-8")
            if "os.File" in content and '"os"' not in content:
                files_api.write_text(content.replace('"net/url"', '"net/url"\n\t"os"'), encoding="utf-8", newline="\n")
        self.run(
            "go-discriminator-postprocess",
            [str(PYTHON), str(HINDSIGHT_ROOT / "scripts/postprocess-go-client.py"),
             "--spec", str(SPEC), "--directory", str(stage)],
            HINDSIGHT_ROOT,
        )
        normalize_generated_text(stage, ".go")
        patterns = ("api_*.go", "model_*.go", "client.go", "configuration.go", "response.go", "utils.go")
        incoming = {path.name: path for pattern in patterns for path in stage.glob(pattern)}
        if not incoming or "client.go" not in incoming:
            raise RuntimeError("Incomplete generated Go package")
        for previous in {path for pattern in patterns for path in target.glob(pattern)}:
            checked_path(previous, target)
            if previous.name not in incoming:
                previous.unlink()
        for name, path in incoming.items():
            shutil.copy2(path, checked_path(target / name, target))
        # Maintained module/test/wrapper/README files were never copied from the generator.
        self.run("go-tidy", [str(GO), "mod", "tidy"], target)
        self.run("go-build", [str(GO), "build", "./..."], target)

    def rust(self) -> None:
        self.run("rust-build", ["cargo.exe", "build", "--release", "--locked"], CLIENTS / "rust")

    def docs(self) -> None:
        self.run(
            "docs-build",
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "& npm.cmd run build"],
            HINDSIGHT_ROOT / "hindsight-docs",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    names = ("openapi", "python", "typescript", "go", "rust", "docs")
    for name in names:
        parser.add_argument(f"--{name}", action="store_true")
    args = parser.parse_args()
    if not any(getattr(args, name) for name in names):
        parser.error("select the required generation/build steps explicitly")
    run = GeneratorRun()
    for name in names:
        if getattr(args, name):
            getattr(run, name)()
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
