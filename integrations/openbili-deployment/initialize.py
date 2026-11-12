"""Run one authorized, bounded native CLI init with private durable evidence.

The marker is exclusive and retained even on failure. A lost client connection
must never trigger a second account import or model-spend run. Status output is
a projection of counts and native stage markers, never history/profile text.
"""

import argparse
import json
import os
import sqlite3
import subprocess
import time
import uuid
from dataclasses import asdict, fields
from pathlib import Path

import httpx
from openbiliclaw.config import load_config
from openbiliclaw.storage.database import Database

ROOT = Path("/app/runtime")
STATE = ROOT / "operator-init-state.json"
LOG = ROOT / "logs/operator-initialization.log"


def save(state: dict) -> None:
    temporary = STATE.with_suffix(".tmp")
    temporary.write_text(json.dumps(state), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(STATE)


def projection() -> dict:
    state = json.loads(STATE.read_text()) if STATE.exists() else {"state": "NOT_STARTED"}
    config = load_config()
    with sqlite3.connect(
        "file:" + str(config.data_path / "openbiliclaw.db") + "?mode=ro", uri=True
    ) as db:
        db.row_factory = sqlite3.Row
        # Reuse the native availability gate without initialize(), migrations,
        # or a writable connection; a raw row count is not a serviceable pool.
        native_database = Database(config.data_path / "openbiliclaw.db")
        native_database.set_admission_min_score(config.discovery.admission_min_score)
        state["pool_available"] = len(native_database._load_available_pool_candidate_rows_on(db))
        state["table_counts"] = {
            name: db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0]
            for name in ("events", "recommendations", "content_cache", "llm_usage")
        }
        row = db.execute(
            "SELECT COUNT(*), SUM(success), SUM(prompt_tokens), SUM(completion_tokens), "
            "SUM(total_tokens), SUM(estimated_cost_cny) FROM llm_usage WHERE id > ?",
            (state.get("start_usage_id", 0),),
        ).fetchone()
        state["usage"] = dict(
            zip(
                (
                    "calls",
                    "successful_calls",
                    "prompt_tokens",
                    "completion_tokens",
                    "total_tokens",
                    "native_estimated_cost_cny",
                ),
                row,
                strict=True,
            )
        )
    state["actual_billed_cost"] = None
    state["enabled_sources"] = [
        field.name
        for field in fields(config.sources)
        if getattr(getattr(config.sources, field.name), "enabled", False)
    ]
    if LOG.exists():
        log = LOG.read_text(encoding="utf-8", errors="replace")
        stages = (
            "1/4 拉取数据",
            "2/4 分析偏好",
            "3/4 生成并保存完整画像",
            "4/4 建立首轮可用内容池",
        )
        state["latest_native_stage"] = max(
            (number for number, marker in enumerate(stages, 1) if marker in log),
            default=0,
        )
    return state


def run() -> None:
    os.umask(0o077)
    config = load_config()
    auth_before = asdict(config.api.auth)
    scheduler_before = asdict(config.scheduler)
    network_before = (config.api.host, config.api.port)
    if config.scheduler.enabled or config.scheduler.source_incremental_enabled:
        raise RuntimeError("Background scheduling must remain disabled")
    token = (ROOT / "bridge-token").read_text().strip()
    with httpx.Client(trust_env=False, timeout=30) as client:
        response = client.get(
            "http://127.0.0.1:8420/api/profile-summary",
            headers={"Authorization": "Bearer " + token},
        )
        if response.status_code != 200 or response.json().get("initialized") is not False:
            raise RuntimeError("This helper only permits the first native initialization")
    with sqlite3.connect(
        "file:" + str(config.data_path / "openbiliclaw.db") + "?mode=ro", uri=True
    ) as db:
        start_usage = db.execute("SELECT COALESCE(MAX(id), 0) FROM llm_usage").fetchone()[0]
    state = {
        "run_id": str(uuid.uuid4()),
        "state": "RUNNING",
        "started_at_epoch": time.time(),
        "start_usage_id": start_usage,
        "history_limit": 200,
        "favorite_limit": 0,
        "follow_limit": 0,
        "native_pool_target": 15,
    }
    # The durable exclusive marker prevents automatic retry, including failures.
    with STATE.open("x", encoding="utf-8") as stream:
        json.dump(state, stream)
    command = [
        "openbiliclaw",
        "init",
        "--bilibili-history-limit",
        "200",
        "--bilibili-favorite-limit",
        "0",
        "--bilibili-follow-limit",
        "0",
        "--no-xhs",
        "--no-douyin",
        "--no-youtube",
        "--no-x",
        "--no-zhihu",
        "--no-reddit",
        "--no-linuxdo",
        "--no-v2ex",
        "--no-weibo",
        "--no-bangumi",
    ]
    with LOG.open("x", encoding="utf-8") as stream:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=stream,
            stderr=subprocess.STDOUT,
            cwd=ROOT,
            env={**os.environ, "PYTHONUNBUFFERED": "1", "NO_COLOR": "1"},
        )
        state["native_pid"] = process.pid
        save(state)
        code = process.wait()
    after = load_config()
    state.update(
        state="EXITED",
        exit_code=code,
        finished_at_epoch=time.time(),
        api_auth_unchanged=auth_before == asdict(after.api.auth),
        scheduler_unchanged=scheduler_before == asdict(after.scheduler),
        network_unchanged=network_before == (after.api.host, after.api.port),
    )
    save(state)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()
    try:
        if args.status:
            print(json.dumps(projection()))
        else:
            run()
    except Exception as error:
        print(json.dumps({"state": "OPERATOR_ERROR", "exception_type": type(error).__name__}))
        raise SystemExit(1) from None
