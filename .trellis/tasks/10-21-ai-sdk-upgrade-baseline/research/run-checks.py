"""Run recorded checks sequentially, retaining exit codes and complete local output."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent / sys.argv[1]
OUT.mkdir(exist_ok=True)
GROUPS = {
    "cancellation": "src/agents/chat-agent-lifecycle.test.ts src/agents/chat-agent-tail.test.ts src/agents/chat-agent-baseline-integration.test.ts src/agents/chat-agent-overflow.test.ts src/agents/parallel-tool-effect.test.ts src/agents/model-observability.test.ts src/agents/run-observability-telemetry.test.ts",
    "provider": "src/agents/tool-disclosure.test.ts src/agents/chat-agent-prefix-cache.test.ts src/agents/chat-agent-images.test.ts src/agents/chat-agent-non-primary.test.ts src/agents/turn-mapping.test.ts src/agents/replay-source-loader.test.ts src/config/provider-factory.test.ts",
    "mcp": "src/mcp/mcp-manager.test.ts src/mcp/mcp-generations.test.ts src/mcp/mcp-manager-change.test.ts src/mcp/mcp-generation-close.test.ts src/mcp/mcp-http.test.ts src/mcp/mcp-schema-compat.test.ts src/mcp/mcp-turn-tools.test.ts src/mcp/mcp-stdio-launch.test.ts src/mcp/mcp-stdio-relay.test.ts",
    "governance": "src/governance/governed-tool.test.ts src/governance/governed-tool-unattended.test.ts src/governance/captured-tool-execution.test.ts src/harness/run-service.test.ts src/harness/recovery-coordinator.test.ts",
    "consumers": "src/agents/compaction-pass.test.ts src/agents/chat-agent-compaction-seam.test.ts src/memory/canonical-local-ingestion.test.ts src/memory/hindsight/hindsight-policy-curator.test.ts src/co-watching/runtime.test.ts",
}
checks = {name: ["pnpm.cmd", "--filter", "@taki/core", "exec", "vitest", "run", *files.split()] for name, files in GROUPS.items()}
checks.update({"typecheck": ["pnpm.cmd", "-r", "typecheck"], "lint": ["pnpm.cmd", "lint"], "tests": ["pnpm.cmd", "-r", "test"], "clippy": ["cargo", "clippy", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--", "-D", "warnings"], "rust-tests": ["cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"]})
checks["tests-bounded"] = ["pnpm.cmd", "-r", "test", "--maxWorkers=4"]
selected = sys.argv[2:] or list(GROUPS)
env = {key: value for key, value in os.environ.items() if not key.startswith(("TAKI_", "OPENAI_", "ANTHROPIC_", "RUN_LIVE_"))}
results = []
for name in selected:
    command = checks[name]
    print("START " + name + ": " + " ".join(command), flush=True)
    started = time.time()
    with (OUT / (name + ".log")).open("wb") as log:
        completed = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
    result = {"name": name, "command": command, "exitCode": completed.returncode, "seconds": round(time.time() - started, 2)}
    results.append(result)
    (OUT / ("results-" + "-".join(selected) + ".json")).write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result), flush=True)
