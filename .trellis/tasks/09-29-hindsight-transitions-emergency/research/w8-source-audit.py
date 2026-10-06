"""Read-only predecessor identity audit; writes only new W8 evidence, never corpus files."""

import hashlib
import json
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
RESEARCH = ROOT / ".trellis/tasks/09-29-hindsight-transitions-emergency/research"
W8_CHANGES = {
    "apps/desktop/src/lib/ws-client-transitions.test.ts",
    "packages/core/src/testing/memory-transition-operator-fixtures.ts",
    "packages/core/src/testing/index.md",
    ".trellis/spec/backend/index.md",
    ".trellis/spec/backend/memory-transitions.md",
    ".trellis/spec/backend/memory-transition-publication.md",
    "apps/desktop/src/windows/home/pages/operations/memory-transition-state.ts",
    "apps/desktop/src/windows/home/pages/operations/memory-transition-progress.tsx",
    "apps/desktop/src/windows/home/pages/operations/memory-transitions-card.tsx",
    "apps/desktop/src/windows/home/pages/operations/memory-transitions-card.test.tsx",
    "apps/desktop/src/windows/home/pages/operations/memory-transitions-browser.test.ts",
    "apps/desktop/src/windows/home/pages/operations/index.md",
    "packages/core/src/memory/transitions/transition-operator-overview.test.ts",
    ".trellis/spec/frontend/memory-transitions.md",
    "packages/core/src/memory/hindsight/hindsight-foreground-recall-lifetime.test.ts",
    "packages/core/src/db/canonical-memory-maintenance-repo.test.ts",
    "packages/core/src/db/pending-memory-repo.test.ts",
    "packages/core/src/db/scheduled-task-repo.test.ts",
    "packages/core/src/db/migrations/041-canonical-memory-maintenance.test.ts",
    "packages/core/src/db/migrations/053-memory-transition-candidates.test.ts",
    "packages/core/src/db/migrations/054-memory-transition-publication.test.ts",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_path(value, root):
    if value.startswith("w5-") and "/" not in value and "\\" not in value:
        return None
    path = Path(value)
    path = path if path.is_absolute() else root / path
    normalized = path.as_posix().lower()
    # Data, frozen working pairs and task evidence are intentionally outside this source audit.
    if "/.runtime/" in normalized or "/.trellis/tasks/" in normalized:
        return None
    if path.suffix.lower() in {".db", ".sqlite", ".sqlite3", ".pyc"}:
        return None
    return path


def entries(value):
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and "path" in item:
                yield item["path"], item
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and len(item) == 64:
                yield key, {"sha256": item}
            elif isinstance(item, dict) and any(
                k in item for k in ["sha256", "checkedSha256", "after"]
            ):
                yield key, item


def git_paths(root):
    def run(*args):
        return (
            subprocess.check_output(["git", "-C", str(root), *args])
            .decode("utf-8")
            .split("\0")
        )

    return sorted(
        set(
            filter(
                None,
                run("diff", "--name-only", "-z", "HEAD")
                + run("ls-files", "--others", "--exclude-standard", "-z"),
            )
        )
    )


def main():
    predecessors = defaultdict(list)
    manifests = []
    names = {
        p for p in RESEARCH.glob("w*-source-*.json") if not p.name.startswith("w8-")
    }
    names |= {
        p
        for p in RESEARCH.glob("w*-source-ownership.json")
        if not p.name.startswith("w8-")
    }
    names.add(RESEARCH / "native-preimplementation-baseline.json")
    names.add(RESEARCH / "w6-committed-actual-source-preflight.json")
    names |= {
        RESEARCH / name
        for name in [
            "w4-prior-source-baseline.json",
            "w5-prior-source-baseline.json",
            "w2-native-files.json",
        ]
    }
    names |= {
        ROOT
        / ".trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7"
        / "emergency-history/b389441a92e74f2988071642a3ef832e/source-files.json",
        ROOT
        / ".trellis/.runtime/stage4-w6-restore/06f1a45b700f447aa313d355ee94f35e/source-files.json",
    }
    for manifest in sorted(names):
        document = json.loads(manifest.read_text(encoding="utf-8-sig"))
        label = manifest.relative_to(ROOT).as_posix()
        manifests.append({"path": label, "sha256": digest(manifest)})
        if isinstance(document, list):
            document = {"files": document}
        for key in [
            "files",
            "checkedFiles",
            "sourceFiles",
            "taki",
            "core",
            "coreFiles",
            "native",
            "nativeDependencies",
        ]:
            base = (
                NATIVE
                if key == "native"
                or manifest.name
                in {"native-preimplementation-baseline.json", "w2-native-files.json"}
                else ROOT
            )
            if key == "nativeDependencies":
                base = NATIVE / "hindsight-api-slim/hindsight_api"
            for name, row in entries(document.get(key)):
                path = source_path(name, base)
                expected = row.get("checkedSha256", row.get("sha256", row.get("after")))
                if path is not None and expected:
                    predecessors[str(path)].append(
                        {"manifest": label, "sha256": expected}
                    )
        for root, files in document.get("roots", {}).items():
            for name, row in entries(files):
                path = source_path(name, Path(root))
                if path is not None:
                    predecessors[str(path)].append(
                        {"manifest": label, "sha256": row["sha256"]}
                    )
    matches, drift, skipped = [], [], []
    for name, origins in sorted(predecessors.items()):
        path = Path(name)
        if not path.is_file():
            skipped.append({"path": name, "reason": "missing predecessor dependency"})
            continue
        current = digest(path)
        matching = [item["manifest"] for item in origins if item["sha256"] == current]
        row = {"path": path.as_posix(), "bytes": path.stat().st_size, "sha256": current}
        if matching:
            matches.append({**row, "matchingManifests": matching})
        else:
            relative = (
                path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else None
            )
            drift.append(
                {**row, "w8Owned": relative in W8_CHANGES, "predecessors": origins}
            )
    source, encoding_issues, module_issues = [], [], []
    for root in [ROOT, NATIVE]:
        for name in git_paths(root):
            path = source_path(name, root)
            if path is None or not path.is_file():
                continue
            if path.suffix.lower() not in {
                ".ts",
                ".tsx",
                ".py",
                ".rs",
                ".json",
                ".md",
                ".js",
                ".mjs",
                ".toml",
                ".yaml",
                ".yml",
                ".sh",
            }:
                continue
            raw = path.read_bytes()
            source.append(
                {
                    "path": path.as_posix(),
                    "bytes": len(raw),
                    "sha256": hashlib.sha256(raw).hexdigest(),
                }
            )
            try:
                text = raw.decode("utf-8")
                if raw.startswith(b"\xef\xbb\xbf"):
                    encoding_issues.append({"path": name, "issue": "BOM"})
            except UnicodeDecodeError:
                encoding_issues.append({"path": name, "issue": "invalid UTF-8"})
                continue
            if (
                root == ROOT
                and "/src/" in path.as_posix()
                and path.suffix in {".ts", ".tsx"}
                and ".test." not in name
            ):
                index = path.parent / "index.md"
                header = text.partition("/**")[2].partition("*/")[0]
                if not all(label in header for label in ["INPUT:", "OUTPUT:", "POS:"]):
                    module_issues.append({"path": name, "issue": "module header"})
                if not index.exists() or path.name not in index.read_text(
                    encoding="utf-8"
                ):
                    module_issues.append({"path": name, "issue": "folder index"})
    report = {
        "scope": "W0-W7 historical source equality plus explicit W8 overlay; excludes all runtime/corpus paths",
        "manifests": manifests,
        "matches": matches,
        "drift": drift,
        "missing": skipped,
        "changedSources": source,
        "encodingIssues": encoding_issues,
        "moduleIssues": module_issues,
    }
    (RESEARCH / "w8-source-audit.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "manifests": len(manifests),
                "matched": len(matches),
                "drift": len(drift),
                "missing": len(skipped),
                "changedSources": len(source),
                "encodingIssues": encoding_issues,
                "moduleIssues": module_issues,
                "driftPaths": [
                    {"path": item["path"], "w8Owned": item["w8Owned"]} for item in drift
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
