"""Use existing UUID indexes without changing association publication ownership.

Revision ID: e40b1e8a7d32
Revises: e30a9d7f6c21
Create Date: 2026-10-05

Only the stored endpoint predicates change. The historical e30 migration and
all row triggers, publication checks, ownership history and lock ordering stay
intact. PostgreSQL-only, like the existing transition publication contract.
"""

from collections.abc import Sequence

from alembic import context, op

from hindsight_api.alembic._dialect import run_for_dialect

revision: str = "e40b1e8a7d32"
down_revision: str | Sequence[str] | None = "e30a9d7f6c21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _replace_guard(*, native_uuid: bool) -> None:
    schema_name = context.config.get_main_option("target_schema")
    schema = f'"{schema_name}".' if schema_name else ""
    # OLD/NEW are typed association records. UUID JSON strings are canonical;
    # absent fields and the nullable legacy entity_id cast to SQL NULL. Keeping
    # the column as UUID enables its existing index instead of scanning id::text.
    # One body also makes downgrade restore precisely the old predicates without
    # invoking e30's destructive, history-refusing downgrade.
    column = "id" if native_uuid else "id::text"
    unit_values = ",".join(
        f"(item->>'{field}')::uuid" if native_uuid else f"item->>'{field}'"
        for field in ("unit_id", "from_unit_id", "to_unit_id")
    )
    entity_values = ",".join(
        f"(item->>'{field}')::uuid" if native_uuid else f"item->>'{field}'"
        for field in ("entity_id", "entity_id_1", "entity_id_2")
    )
    op.execute(f"""
        CREATE OR REPLACE FUNCTION {schema}guard_transition_association_write() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE target_bank TEXT; items JSONB[];
        BEGIN
            IF TG_OP='INSERT' THEN items:=ARRAY[to_jsonb(NEW)];
            ELSIF TG_OP='DELETE' THEN items:=ARRAY[to_jsonb(OLD)];
            ELSE items:=ARRAY[to_jsonb(OLD),to_jsonb(NEW)]; END IF;
            -- Both row ownership and every endpoint join the same sorted set
            -- across OLD/NEW. A mislabeled link cannot escape the Bank whose
            -- paired snapshot actually retains it, even during cascades.
            FOR target_bank IN
                SELECT DISTINCT bank_id FROM unnest(items) AS row_data(item)
                    CROSS JOIN LATERAL (
                        SELECT item->>'bank_id' AS bank_id
                        UNION
                        SELECT bank_id FROM {schema}memory_units WHERE {column} IN
                            ({unit_values})
                        UNION SELECT bank_id FROM {schema}invalidated_memory_units WHERE {column} IN
                            ({unit_values})
                        UNION SELECT bank_id FROM {schema}entities WHERE {column} IN
                            ({entity_values})
                    ) owned WHERE bank_id IS NOT NULL ORDER BY bank_id
            LOOP PERFORM {schema}check_transition_publication(target_bank); END LOOP;
            IF TG_OP='DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$
    """)


def _pg_upgrade() -> None:
    _replace_guard(native_uuid=True)


def _pg_downgrade() -> None:
    _replace_guard(native_uuid=False)


def upgrade() -> None:
    run_for_dialect(pg=_pg_upgrade)


def downgrade() -> None:
    run_for_dialect(pg=_pg_downgrade)
