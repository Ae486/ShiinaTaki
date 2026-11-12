"""Read-only historical source preview; never emits conversation text or changes data."""
import argparse
import datetime
import json
import pathlib
import sqlite3


def preview(database):
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute("BEGIN")

    def rows(sql, params=()):
        return [dict(row) for row in connection.execute(sql, params)]

    cursors = rows("""SELECT c.* FROM canonical_memory_ingestion_cursors c
        JOIN canonical_memory_authority_state a ON a.active_epoch_id=c.authority_epoch_id""")
    scopes = []
    for cursor in cursors:
        epoch, character = cursor["authority_epoch_id"], cursor["character_id"]
        gaps = rows("""SELECT t.seq,t.id,t.created_at,
            (SELECT count(*) FROM canonical_memory_primary_commits p WHERE p.timeline_seq=t.seq) local_proofs,
            (SELECT count(*) FROM hindsight_ingestion_primary_commits p WHERE p.timeline_seq=t.seq) hindsight_proofs
            FROM timeline_messages t WHERE t.character_id=? AND t.role='user' AND t.seq>=?
            AND NOT EXISTS (SELECT 1 FROM canonical_memory_primary_commits p
                WHERE p.timeline_seq=t.seq AND p.authority_epoch_id=?) ORDER BY t.seq""",
            (character, cursor["eligibility_start_seq"], epoch))
        for gap in gaps:
            gap["classification"] = "unresolved_historical_origin"
            gap["approved_mutations"] = []
            gap["candidate_runs_by_time_only"] = rows("""SELECT run_id,state,recovery_classification,
                started_at,terminal_at,cancel_requested_at,outcome
                FROM runs WHERE character_id=?
                AND abs((julianday(created_at)-julianday(?))*86400000)<100
                ORDER BY created_at""", (character, gap["created_at"]))
            for run in gap["candidate_runs_by_time_only"]:
                run["binding_evidence"] = "timestamp_association_only_not_an_exact_join"
                run["model_effects"] = rows("""SELECT state,count(*) count FROM run_effects
                    WHERE run_id=? AND kind='model' GROUP BY state""", (run["run_id"],))
        pending = rows("""SELECT timeline_seq,committed_through_seq FROM canonical_memory_primary_commits
            WHERE authority_epoch_id=? AND character_id=? AND ingestion_span_id IS NULL ORDER BY timeline_seq""",
            (epoch, character))
        boundaries = [cursor["eligibility_start_seq"] - 1] + [gap["seq"] for gap in gaps]
        tail = connection.execute("SELECT max(seq) FROM timeline_messages WHERE character_id=?", (character,)).fetchone()[0]
        groups = []
        for index, lower in enumerate(boundaries):
            upper = boundaries[index + 1] - 1 if index + 1 < len(boundaries) else tail
            group = [row for row in pending if lower < row["timeline_seq"] <= upper]
            if group:
                groups.append({"from_seq": group[0]["timeline_seq"], "through_seq": group[-1]["timeline_seq"],
                    "witness_rows": len(group), "eligibility": "existing_witness_candidates_require_runtime_digest_checks"})
        scopes.append({"cursor": cursor, "historical_gaps": gaps,
            "pending_witness_rows": len(pending), "independent_candidate_groups": groups})
    result = {"database": str(database.resolve()), "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "read_mode": "SQLite URI mode=ro; query_only=ON; one read transaction",
        "source_table_present": bool(rows("SELECT name FROM sqlite_master WHERE type='table' AND name='primary_conversation_sources'")),
        "scopes": scopes, "mutations_performed": 0, "application_model_calls": 0,
        "limits": ["Old unknown rows are not classified by the additive migration.",
            "Run time proximity does not prove Timeline membership or permit Run settlement.",
            "Gate/extraction call counts and currency cost depend on batching, saved plans and model output; not inferred from witness count."]}
    connection.rollback()
    connection.close()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(preview(args.db), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
