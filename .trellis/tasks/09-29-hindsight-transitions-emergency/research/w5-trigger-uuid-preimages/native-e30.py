"""Durable all-writer transition ownership independent from finite D78 leases.

Revision ID: e30a9d7f6c21
Revises: d77a4f8c2e10
Create Date: 2026-09-30

PostgreSQL SQL-row authority only. History has no FK to mutable Banks. No expiry
path reopens a fence; expiration revokes execution only. Supported writers enter
through cursor -> maintenance owner -> transition owner before canonical rows.
The SQL fallback also rejects a missed writer at its actual publication boundary.
"""

from collections.abc import Sequence

from alembic import context, op

from hindsight_api.alembic._dialect import run_for_dialect

revision: str = "e30a9d7f6c21"
down_revision: str | Sequence[str] | None = "d77a4f8c2e10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Direct Bank ownership is explicit. Association tables below derive both
# endpoints so cross-Bank links cannot smuggle a write into a retired Bank.
_BANK_TABLES = (
    "banks",
    "documents",
    "chunks",
    "memory_units",
    "invalidated_memory_units",
    "entities",
    "observation_history",
    "mental_models",
    "mental_model_history",
    "knowledge_pages",
    "directives",
    "graph_maintenance_queue",
    "memory_mutation_receipts",
    "memory_native_operation_receipts",
    "memory_retain_part_receipts",
    "memory_current_state_transfers",
    "memory_current_state_transfer_mappings",
    "memory_cutover_verifications",
    "memory_cutover_steps",
    "memory_cutover_actions",
    "memory_cutover_evidence_pages",
    "memory_application_banks",
    "memory_application_native_heads",
    "memory_application_artifacts",
    "memory_application_changes",
    "memory_application_operations",
    "memory_application_bodies",
    "memory_application_body_parts",
    "memory_application_snapshots",
)
_ASSOCIATIONS = ("unit_entities", "entity_cooccurrences", "memory_links")


def _pg_schema_prefix() -> str:
    schema = context.config.get_main_option("target_schema")
    return f'"{schema}".' if schema else ""


def _pg_upgrade() -> None:
    schema = _pg_schema_prefix()
    # No backfill: an old currently empty Bank has no proof that it was never
    # used. Only a real INSERT after this migration receives a creation witness.
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_bank_origins (
            bank_id TEXT PRIMARY KEY, creation_id UUID NOT NULL DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            ever_used BOOLEAN NOT NULL DEFAULT false, deleted BOOLEAN NOT NULL DEFAULT false
        )
    """)
    op.execute(f"""
        CREATE FUNCTION {schema}guard_transition_bank_origin() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP='DELETE' OR NEW.bank_id<>OLD.bank_id OR NEW.creation_id<>OLD.creation_id
                OR NEW.created_at<>OLD.created_at OR (OLD.ever_used AND NOT NEW.ever_used)
                OR (OLD.deleted AND NOT NEW.deleted) THEN
                RAISE EXCEPTION 'taki_transition_origin_immutable' USING ERRCODE='P0001';
            END IF;
            RETURN NEW;
        END $$
    """)
    op.execute(
        f"CREATE TRIGGER guard_transition_bank_origin BEFORE UPDATE OR DELETE ON {schema}memory_transition_bank_origins "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_bank_origin()"
    )
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_requests (
            bank_id TEXT NOT NULL, transition_id UUID NOT NULL,
            provider_lineage UUID NOT NULL, bank_generation UUID NOT NULL,
            actor_hash TEXT NOT NULL CHECK(actor_hash ~ '^[0-9a-f]{{64}}$'),
            request_hash TEXT NOT NULL CHECK(request_hash ~ '^[0-9a-f]{{64}}$'),
            request JSONB NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('draining','fenced','proven','retired','active','aborted','quarantined')),
            revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
            generation BIGINT NOT NULL CHECK(generation>0),
            attempt_id UUID NOT NULL, fence_token UUID NOT NULL,
            lease_expires_at TIMESTAMPTZ NOT NULL,
            acquired_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
            fenced_at TIMESTAMPTZ, proof JSONB, outcome JSONB,
            PRIMARY KEY(bank_id,transition_id)
        )
    """)
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_fences (
            bank_id TEXT PRIMARY KEY,
            generation BIGINT NOT NULL DEFAULT 0 CHECK(generation>=0),
            transition_id UUID,
            admission_version BIGINT NOT NULL DEFAULT 0,
            FOREIGN KEY(bank_id,transition_id) REFERENCES {schema}memory_transition_requests(bank_id,transition_id)
        )
    """)
    op.execute(f"INSERT INTO {schema}memory_transition_fences(bank_id) SELECT bank_id FROM {schema}banks")
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_writers (
            writer_id UUID PRIMARY KEY, bank_id TEXT NOT NULL,
            generation BIGINT NOT NULL CHECK(generation>=0), operation_id UUID,
            state TEXT NOT NULL CHECK(state IN ('running','completed','failed','abandoned')),
            lease_expires_at TIMESTAMPTZ NOT NULL,
            entered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), finished_at TIMESTAMPTZ
        )
    """)
    op.execute(f"CREATE INDEX ON {schema}memory_transition_writers(bank_id,state)")
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_work (
            bank_id TEXT NOT NULL, transition_id UUID NOT NULL, operation_id UUID NOT NULL,
            parent_operation_id UUID, parent_writer_id UUID,
            PRIMARY KEY(bank_id,transition_id,operation_id),
            FOREIGN KEY(bank_id,transition_id) REFERENCES {schema}memory_transition_requests(bank_id,transition_id)
        )
    """)
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_history (
            bank_id TEXT NOT NULL, transition_id UUID NOT NULL, revision BIGINT NOT NULL,
            event JSONB NOT NULL, event_hash TEXT NOT NULL CHECK(event_hash ~ '^[0-9a-f]{{64}}$'),
            PRIMARY KEY(bank_id,transition_id,revision),
            FOREIGN KEY(bank_id,transition_id) REFERENCES {schema}memory_transition_requests(bank_id,transition_id)
        )
    """)
    op.execute(f"""
        CREATE FUNCTION {schema}guard_transition_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'taki_transition_history_immutable' USING ERRCODE='P0001'; END $$
    """)
    op.execute(
        f"CREATE TRIGGER guard_transition_history BEFORE UPDATE OR DELETE ON {schema}memory_transition_history "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_history()"
    )
    # No FK to mutable async/history rows: absence and pruning must remain
    # detectable. Restores COPY these original events rather than deriving them.
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_initializations (
            bank_id TEXT NOT NULL, event_key TEXT NOT NULL,
            creation_id UUID NOT NULL, import_id UUID NOT NULL,
            template_hash TEXT NOT NULL CHECK(template_hash ~ '^[0-9a-f]{{64}}$'),
            kind TEXT NOT NULL CHECK(kind IN ('import','import_completed','admission','history','completed')),
            operation_id UUID, evidence JSONB NOT NULL,
            PRIMARY KEY(bank_id,event_key)
        )
    """)
    op.execute(
        f"CREATE TRIGGER guard_transition_initialization_history BEFORE UPDATE OR DELETE ON {schema}memory_transition_initializations "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_history()"
    )
    # Share the proven native plan/action/page storage shape, but keep all
    # transition identities and evidence out of the D78 first-import tables.
    for target, source in (
        ("memory_transition_maintenance", "memory_cutover_verifications"),
        ("memory_transition_steps", "memory_cutover_steps"),
        ("memory_transition_actions", "memory_cutover_actions"),
        ("memory_transition_evidence_pages", "memory_cutover_evidence_pages"),
    ):
        op.execute(f"CREATE TABLE {schema}{target} (LIKE {schema}{source} INCLUDING ALL)")
    op.execute(
        f"ALTER TABLE {schema}memory_transition_maintenance ADD FOREIGN KEY(bank_id,verification_id) "
        f"REFERENCES {schema}memory_transition_requests(bank_id,transition_id)"
    )
    op.execute(
        f"ALTER TABLE {schema}memory_transition_steps ADD FOREIGN KEY(bank_id,verification_id) "
        f"REFERENCES {schema}memory_transition_maintenance(bank_id,verification_id)"
    )
    op.execute(
        f"ALTER TABLE {schema}memory_transition_actions ADD FOREIGN KEY(bank_id,verification_id,step_key) "
        f"REFERENCES {schema}memory_transition_steps(bank_id,verification_id,step_key)"
    )
    op.execute(
        f"ALTER TABLE {schema}memory_transition_evidence_pages ADD FOREIGN KEY(bank_id,verification_id) "
        f"REFERENCES {schema}memory_transition_maintenance(bank_id,verification_id)"
    )
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_auxiliary_pages (
            bank_id TEXT NOT NULL, transition_id UUID NOT NULL,
            page_number INTEGER NOT NULL CHECK(page_number>=0),
            page_hash TEXT NOT NULL CHECK(page_hash ~ '^[0-9a-f]{{64}}$'),
            records JSONB NOT NULL,
            PRIMARY KEY(bank_id,transition_id,page_number),
            FOREIGN KEY(bank_id,transition_id) REFERENCES {schema}memory_transition_requests(bank_id,transition_id)
        )
    """)
    op.execute(f"""
        CREATE TABLE {schema}memory_transition_deltas (
            bank_id TEXT NOT NULL, transition_id UUID NOT NULL, operation_id UUID NOT NULL,
            request_hash TEXT NOT NULL CHECK(request_hash ~ '^[0-9a-f]{{64}}$'),
            request JSONB NOT NULL, result JSONB NOT NULL,
            PRIMARY KEY(bank_id,transition_id), UNIQUE(bank_id,operation_id),
            FOREIGN KEY(bank_id,transition_id) REFERENCES {schema}memory_transition_requests(bank_id,transition_id)
        )
    """)
    op.execute(
        f"CREATE TRIGGER guard_transition_delta_history BEFORE UPDATE OR DELETE ON {schema}memory_transition_deltas "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_history()"
    )
    # This check is also used by the queue trigger, which must NOT acquire the
    # cursor after an existing async-operation row. Its owner-tuple touch makes
    # a late admission visible to the final RR fence as a serialization conflict.
    op.execute(f"""
        CREATE FUNCTION {schema}transition_write_permit(target_bank TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
        DECLARE permit JSONB; closed BOOLEAN;
        BEGIN
            permit:=COALESCE(NULLIF(current_setting('hindsight.transition_write',true),''),'{{}}')::jsonb;
            closed:=COALESCE((permit->>'bank_scope_closed')::boolean,false);
            IF permit->>'bank_id' IS DISTINCT FROM target_bank THEN
                SELECT value INTO permit FROM jsonb_array_elements(COALESCE(permit->'additional_writers','[]'::jsonb))
                    WHERE value->>'bank_id'=target_bank LIMIT 1;
            END IF;
            IF closed AND (permit IS NULL OR permit->>'bank_id' IS DISTINCT FROM target_bank) THEN
                RAISE EXCEPTION 'taki_transition_writer_stale' USING ERRCODE='P0001';
            END IF;
            IF to_regclass(permit->>'schema_table') IS DISTINCT FROM to_regclass('{schema}memory_transition_fences') THEN
                RETURN '{{}}'::jsonb;
            END IF;
            RETURN COALESCE(permit,'{{}}'::jsonb);
        END $$
    """)
    op.execute(
        f"""
        CREATE FUNCTION {schema}check_transition_publication(target_bank TEXT, admission BOOLEAN DEFAULT false)
        RETURNS void LANGUAGE plpgsql AS $$
        DECLARE fence RECORD; owner RECORD; writer {schema}memory_transition_writers%ROWTYPE; permit JSONB;
        BEGIN
            IF target_bank IS NULL THEN RETURN; END IF;
            IF NOT admission THEN
                PERFORM 1 FROM {schema}replication_bank_state WHERE bank_id=target_bank FOR UPDATE;
                PERFORM 1 FROM {schema}memory_bank_maintenance WHERE bank_id=target_bank FOR UPDATE;
            END IF;
            INSERT INTO {schema}memory_transition_fences(bank_id) VALUES(target_bank) ON CONFLICT DO NOTHING;
            SELECT * INTO fence FROM {schema}memory_transition_fences WHERE bank_id=target_bank FOR UPDATE;
            permit := {schema}transition_write_permit(target_bank);
            IF permit->>'bank_id' IS DISTINCT FROM target_bank
               OR to_regclass(permit->>'schema_table') IS DISTINCT FROM to_regclass(TG_TABLE_SCHEMA_PLACEHOLDER) THEN
                permit := '{{}}'::jsonb;
            END IF;
            IF permit->>'writer_id' IS NOT NULL THEN
                SELECT * INTO writer FROM {schema}memory_transition_writers
                    WHERE writer_id=(permit->>'writer_id')::uuid AND bank_id=target_bank;
                IF writer.writer_id IS NULL OR writer.state<>'running' OR writer.lease_expires_at<=clock_timestamp()
                   OR writer.generation<>fence.generation THEN
                    RAISE EXCEPTION 'taki_transition_writer_stale' USING ERRCODE='P0001';
                END IF;
            END IF;
            IF fence.transition_id IS NULL THEN
                IF permit->>'transition_id' IS NOT NULL THEN
                    RAISE EXCEPTION 'taki_transition_writer_stale' USING ERRCODE='P0001';
                END IF;
                RETURN;
            END IF;
            SELECT * INTO owner FROM {schema}memory_transition_requests
                WHERE bank_id=target_bank AND transition_id=fence.transition_id;
            IF permit->>'transition_id' IS NOT NULL THEN
                IF owner.phase='fenced' AND permit->>'transition_id'=owner.transition_id::text
                    AND permit->>'attempt_id'=owner.attempt_id::text
                    AND permit->>'fence_token'=owner.fence_token::text
                    AND (permit->>'generation')::bigint=owner.generation
                    AND owner.lease_expires_at>clock_timestamp() THEN RETURN; END IF;
                RAISE EXCEPTION 'taki_transition_writer_stale' USING ERRCODE='P0001';
            END IF;
            IF owner.phase IN ('active','aborted') THEN RETURN; END IF;
            -- Composite IS NOT NULL requires EVERY field to be non-null;
            -- a live writer legitimately has no finished_at/operation_id.
            IF owner.phase='draining' AND writer.writer_id IS NOT NULL AND writer.state='running' THEN RETURN; END IF;
            RAISE EXCEPTION 'taki_transition_fenced' USING ERRCODE='P0001';
        END $$
    """.replace("TG_TABLE_SCHEMA_PLACEHOLDER", f"'{schema}memory_transition_fences'")
    )
    op.execute(f"""
        CREATE FUNCTION {schema}transition_initialization_import(target_bank TEXT, permit JSONB)
        RETURNS UUID LANGUAGE SQL AS $$
            SELECT i.import_id FROM {schema}memory_transition_initializations i
            JOIN {schema}memory_transition_bank_origins o ON o.bank_id=i.bank_id AND o.creation_id=i.creation_id
            JOIN {schema}memory_transition_writers w ON w.bank_id=i.bank_id AND w.writer_id::text=permit->>'writer_id'
            JOIN {schema}memory_transition_fences f ON f.bank_id=i.bank_id AND f.generation=w.generation
            WHERE i.bank_id=target_bank AND i.kind='import' AND NOT o.ever_used AND NOT o.deleted
                AND i.import_id::text=permit->>'initialization_import_id'
                AND permit->>'bank_id'=target_bank
                AND to_regclass(permit->>'schema_table')=to_regclass('{schema}memory_transition_fences')
                AND w.state='running' AND w.lease_expires_at>clock_timestamp()
        $$
    """)
    op.execute(f"""
        CREATE FUNCTION {schema}transition_initialization_operation(target_bank TEXT, permit JSONB)
        RETURNS UUID LANGUAGE SQL AS $$
            SELECT i.operation_id FROM {schema}memory_transition_initializations i
            JOIN {schema}memory_transition_bank_origins o ON o.bank_id=i.bank_id AND o.creation_id=i.creation_id
            JOIN {schema}memory_transition_writers w ON w.bank_id=i.bank_id AND w.writer_id::text=permit->>'writer_id'
            JOIN {schema}memory_transition_fences f ON f.bank_id=i.bank_id AND f.generation=w.generation
            JOIN {schema}async_operations a ON a.bank_id=i.bank_id AND a.operation_id=i.operation_id
            WHERE i.bank_id=target_bank AND i.kind='admission' AND NOT o.ever_used AND NOT o.deleted
                AND i.operation_id::text=permit->>'operation_id'
                AND permit->>'bank_id'=target_bank
                AND to_regclass(permit->>'schema_table')=to_regclass('{schema}memory_transition_fences')
                AND a.operation_type='refresh_mental_model' AND a.task_payload=i.evidence->'task'
                AND a.status IN ('pending','processing')
                AND w.state='running' AND w.lease_expires_at>clock_timestamp()
                AND (w.operation_id=i.operation_id OR
                    (w.operation_id IS NULL AND w.writer_id::text=i.evidence->>'writer_id'))
        $$
    """)
    op.execute(f"""
        CREATE FUNCTION {schema}guard_transition_bank_write() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE before_bank TEXT; after_bank TEXT; permit JSONB; initial_operation UUID; initial_import UUID;
        BEGIN
            -- Read bundles append immutable transport bodies; they do not
            -- publish heads, artifacts or cursors. Only the server's read
            -- materializer sets this local capability, never an HTTP field.
            IF TG_OP='INSERT' AND TG_TABLE_NAME IN
                ('memory_application_bodies','memory_application_body_parts','memory_application_snapshots')
                AND to_regclass(NULLIF(current_setting('hindsight.transition_read',true),''))=
                    to_regclass('{schema}memory_transition_fences') THEN RETURN NEW; END IF;
            IF TG_OP<>'INSERT' THEN before_bank := to_jsonb(OLD)->>'bank_id'; END IF;
            IF TG_OP<>'DELETE' THEN after_bank := to_jsonb(NEW)->>'bank_id'; END IF;
            IF before_bank IS NOT NULL THEN PERFORM {schema}check_transition_publication(before_bank); END IF;
            IF after_bank IS NOT NULL AND after_bank IS DISTINCT FROM before_bank THEN
                PERFORM {schema}check_transition_publication(after_bank);
            END IF;
            permit:={schema}transition_write_permit(COALESCE(after_bank,before_bank));
            IF TG_TABLE_NAME IN ('banks','mental_models','directives','mental_model_history') THEN
                initial_import:={schema}transition_initialization_import(COALESCE(after_bank,before_bank),permit);
                initial_operation:={schema}transition_initialization_operation(COALESCE(after_bank,before_bank),permit);
                IF initial_operation IS NOT NULL AND TG_TABLE_NAME IN ('mental_models','mental_model_history') THEN
                    IF NOT EXISTS(SELECT 1 FROM {schema}memory_transition_initializations i
                        WHERE i.bank_id=COALESCE(after_bank,before_bank) AND i.kind='admission'
                          AND i.operation_id=initial_operation AND i.evidence->>'model_id'=
                            CASE WHEN TG_TABLE_NAME='mental_models' THEN to_jsonb(NEW)->>'id'
                            ELSE to_jsonb(NEW)->>'mental_model_id' END) THEN initial_operation:=NULL; END IF;
                END IF;
                IF TG_TABLE_NAME='mental_model_history' AND TG_OP='INSERT' AND initial_operation IS NOT NULL THEN
                    INSERT INTO {schema}memory_transition_initializations
                        (bank_id,event_key,creation_id,import_id,template_hash,kind,operation_id,evidence)
                        SELECT after_bank,'history:'||(to_jsonb(NEW)->>'id'),creation_id,import_id,template_hash,
                            'history',initial_operation,to_jsonb(NEW)
                        FROM {schema}memory_transition_initializations
                        WHERE bank_id=after_bank AND kind='admission' AND operation_id=initial_operation;
                    RETURN NEW;
                END IF;
                -- After first template admission, an extra ordinary config,
                -- model or directive edit permanently ends unused eligibility.
                -- Only the importer or its exact worker may explain these rows.
                IF TG_TABLE_NAME IN ('banks','mental_models','directives') AND
                    EXISTS(SELECT 1 FROM {schema}memory_transition_initializations
                        WHERE bank_id=COALESCE(after_bank,before_bank) AND kind='import') AND
                    (TG_OP='DELETE' OR (initial_import IS NULL AND
                        (initial_operation IS NULL OR TG_TABLE_NAME<>'mental_models'))) THEN
                    UPDATE {schema}memory_transition_bank_origins SET ever_used=true
                        WHERE bank_id IN (before_bank,after_bank) AND NOT ever_used;
                END IF;
            END IF;
            IF TG_TABLE_NAME='banks' AND TG_OP='INSERT' THEN
                INSERT INTO {schema}memory_transition_bank_origins(bank_id) VALUES(after_bank) ON CONFLICT DO NOTHING;
            ELSIF TG_TABLE_NAME='banks' AND TG_OP='DELETE' THEN
                UPDATE {schema}memory_transition_bank_origins SET deleted=true WHERE bank_id=before_bank;
            ELSIF TG_TABLE_NAME IN ('documents','chunks','memory_units','invalidated_memory_units','entities',
                'observation_history','mental_model_history','knowledge_pages','memory_mutation_receipts',
                'memory_native_operation_receipts','memory_retain_part_receipts','memory_application_artifacts',
                'memory_application_operations') THEN
                UPDATE {schema}memory_transition_bank_origins SET ever_used=true
                    WHERE bank_id IN (before_bank,after_bank) AND NOT ever_used;
            END IF;
            IF TG_OP='DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$
    """)
    for table in _BANK_TABLES:
        op.execute(
            f"CREATE TRIGGER guard_transition_bank_write BEFORE INSERT OR UPDATE OR DELETE ON {schema}{table} "
            f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_bank_write()"
        )
    # State's idempotent INSERT is used by read/lock helpers too. Fence only
    # actual cursor/generation mutations; journal appends/prunes are publications.
    op.execute(
        f"CREATE TRIGGER guard_transition_replication_state BEFORE UPDATE OR DELETE ON {schema}replication_bank_state "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_bank_write()"
    )
    op.execute(
        f"CREATE TRIGGER guard_transition_replication_journal BEFORE INSERT OR UPDATE OR DELETE ON {schema}replication_logical_changes "
        f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_bank_write()"
    )
    op.execute(f"""
        CREATE FUNCTION {schema}guard_transition_association_write() RETURNS trigger LANGUAGE plpgsql AS $$
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
                        SELECT bank_id FROM {schema}memory_units WHERE id::text IN
                            (item->>'unit_id',item->>'from_unit_id',item->>'to_unit_id')
                        UNION SELECT bank_id FROM {schema}invalidated_memory_units WHERE id::text IN
                            (item->>'unit_id',item->>'from_unit_id',item->>'to_unit_id')
                        UNION SELECT bank_id FROM {schema}entities WHERE id::text IN
                            (item->>'entity_id',item->>'entity_id_1',item->>'entity_id_2')
                    ) owned WHERE bank_id IS NOT NULL ORDER BY bank_id
            LOOP PERFORM {schema}check_transition_publication(target_bank); END LOOP;
            IF TG_OP='DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$
    """)
    for table in _ASSOCIATIONS:
        op.execute(
            f"CREATE TRIGGER guard_transition_association_write BEFORE INSERT OR UPDATE OR DELETE ON {schema}{table} "
            f"FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_association_write()"
        )
    op.execute(f"""
        CREATE FUNCTION {schema}guard_transition_queue_admission() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE fence RECORD; owner RECORD; permit JSONB; parent_id UUID; parent_writer UUID; initial_operation UUID;
        BEGIN
            permit:={schema}transition_write_permit(NEW.bank_id);
            IF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status<>'completed' THEN
                initial_operation:={schema}transition_initialization_operation(NEW.bank_id,permit);
                IF initial_operation=NEW.operation_id THEN
                    INSERT INTO {schema}memory_transition_initializations
                        (bank_id,event_key,creation_id,import_id,template_hash,kind,operation_id,evidence)
                        SELECT NEW.bank_id,'completed:'||NEW.operation_id::text,i.creation_id,i.import_id,i.template_hash,
                            'completed',NEW.operation_id,to_jsonb(m)-'embedding'
                        FROM {schema}memory_transition_initializations i
                        JOIN {schema}mental_models m ON m.bank_id=i.bank_id AND m.id=i.evidence->>'model_id'
                        WHERE i.bank_id=NEW.bank_id AND i.kind='admission' AND i.operation_id=initial_operation
                        ON CONFLICT DO NOTHING;
                END IF;
            END IF;
            IF NEW.status NOT IN ('pending','processing') OR (TG_OP='UPDATE'
                AND OLD.status IN ('pending','processing') AND OLD.bank_id=NEW.bank_id) THEN RETURN NEW; END IF;
            INSERT INTO {schema}memory_transition_fences(bank_id) VALUES(NEW.bank_id) ON CONFLICT DO NOTHING;
            UPDATE {schema}memory_transition_fences SET admission_version=admission_version+1
                WHERE bank_id=NEW.bank_id RETURNING * INTO fence;
            -- A retired callback must not enqueue work that a fresh worker
            -- could execute under today's generation. Validate inherited
            -- execution identity even when ordinary new roots are allowed.
            -- The admission form keeps the queue's owner-only lock order.
            permit:={schema}transition_write_permit(NEW.bank_id);
            IF permit->>'writer_id' IS NOT NULL OR permit->>'transition_id' IS NOT NULL THEN
                PERFORM {schema}check_transition_publication(NEW.bank_id,true);
            END IF;
            IF NOT EXISTS(SELECT 1 FROM {schema}memory_transition_initializations i
                WHERE i.bank_id=NEW.bank_id AND i.kind='admission' AND i.operation_id=NEW.operation_id
                  AND i.import_id={schema}transition_initialization_import(NEW.bank_id,permit)
                  AND i.evidence->'task'=NEW.task_payload AND i.evidence->>'writer_id'=permit->>'writer_id'
                  AND NEW.operation_type='refresh_mental_model') THEN
                UPDATE {schema}memory_transition_bank_origins SET ever_used=true WHERE bank_id=NEW.bank_id AND NOT ever_used;
            END IF;
            IF fence.transition_id IS NULL THEN RETURN NEW; END IF;
            SELECT * INTO owner FROM {schema}memory_transition_requests
                WHERE bank_id=NEW.bank_id AND transition_id=fence.transition_id;
            IF owner.phase IN ('active','aborted') THEN RETURN NEW; END IF;
            IF owner.phase='draining' THEN
                IF EXISTS(SELECT 1 FROM {schema}memory_transition_work WHERE bank_id=NEW.bank_id
                    AND transition_id=fence.transition_id AND operation_id=NEW.operation_id) THEN RETURN NEW; END IF;
                parent_id:=NULLIF(permit->>'operation_id','')::uuid;
                parent_writer:=NULLIF(permit->>'writer_id','')::uuid;
                IF permit->>'bank_id'=NEW.bank_id
                   AND to_regclass(permit->>'schema_table')=to_regclass('{schema}memory_transition_fences')
                   AND EXISTS(SELECT 1 FROM {schema}memory_transition_writers WHERE writer_id=parent_writer
                       AND bank_id=NEW.bank_id AND state='running' AND generation=fence.generation
                       AND lease_expires_at>clock_timestamp())
                   AND ((EXISTS(SELECT 1 FROM {schema}memory_transition_work WHERE bank_id=NEW.bank_id
                            AND transition_id=fence.transition_id AND operation_id=parent_id)
                         AND EXISTS(SELECT 1 FROM {schema}async_operations WHERE bank_id=NEW.bank_id
                            AND operation_id=parent_id AND status IN ('pending','processing')))
                        OR EXISTS(SELECT 1 FROM {schema}memory_transition_writers WHERE writer_id=parent_writer
                            AND operation_id IS NULL AND entered_at<=owner.acquired_at)) THEN
                    INSERT INTO {schema}memory_transition_work
                        (bank_id,transition_id,operation_id,parent_operation_id,parent_writer_id)
                        VALUES(NEW.bank_id,fence.transition_id,NEW.operation_id,parent_id,parent_writer) ON CONFLICT DO NOTHING;
                    RETURN NEW;
                END IF;
            END IF;
            RAISE EXCEPTION 'taki_transition_fenced' USING ERRCODE='P0001';
        END $$
    """)
    op.execute(
        f"CREATE TRIGGER zz_guard_transition_queue_admission BEFORE INSERT OR UPDATE OF status,bank_id "
        f"ON {schema}async_operations FOR EACH ROW EXECUTE FUNCTION {schema}guard_transition_queue_admission()"
    )


def _pg_downgrade() -> None:
    schema = _pg_schema_prefix()
    op.execute(f"""DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM {schema}memory_transition_requests)
           OR EXISTS(SELECT 1 FROM {schema}memory_transition_bank_origins)
           OR EXISTS(SELECT 1 FROM {schema}memory_transition_initializations) THEN
            RAISE EXCEPTION 'Cannot downgrade retained transition ownership/history';
        END IF;
    END $$""")
    op.execute(f"DROP TRIGGER zz_guard_transition_queue_admission ON {schema}async_operations")
    op.execute(f"DROP FUNCTION {schema}guard_transition_queue_admission()")
    for table in _ASSOCIATIONS:
        op.execute(f"DROP TRIGGER guard_transition_association_write ON {schema}{table}")
    op.execute(f"DROP FUNCTION {schema}guard_transition_association_write()")
    op.execute(f"DROP TRIGGER guard_transition_replication_state ON {schema}replication_bank_state")
    op.execute(f"DROP TRIGGER guard_transition_replication_journal ON {schema}replication_logical_changes")
    for table in _BANK_TABLES:
        op.execute(f"DROP TRIGGER guard_transition_bank_write ON {schema}{table}")
    op.execute(f"DROP FUNCTION {schema}guard_transition_bank_write()")
    op.execute(f"DROP FUNCTION {schema}transition_initialization_operation(TEXT,JSONB)")
    op.execute(f"DROP FUNCTION {schema}transition_initialization_import(TEXT,JSONB)")
    op.execute(f"DROP FUNCTION {schema}check_transition_publication(TEXT,BOOLEAN)")
    op.execute(f"DROP FUNCTION {schema}transition_write_permit(TEXT)")
    for table in (
        "memory_transition_deltas",
        "memory_transition_initializations",
        "memory_transition_auxiliary_pages",
        "memory_transition_evidence_pages",
        "memory_transition_actions",
        "memory_transition_steps",
        "memory_transition_maintenance",
        "memory_transition_history",
        "memory_transition_work",
        "memory_transition_writers",
        "memory_transition_fences",
        "memory_transition_requests",
    ):
        op.execute(f"DROP TABLE {schema}{table}")
    op.execute(f"DROP FUNCTION {schema}guard_transition_history()")
    op.execute(f"DROP TABLE {schema}memory_transition_bank_origins")
    op.execute(f"DROP FUNCTION {schema}guard_transition_bank_origin()")


def upgrade() -> None:
    run_for_dialect(pg=_pg_upgrade)


def downgrade() -> None:
    run_for_dialect(pg=_pg_downgrade)
