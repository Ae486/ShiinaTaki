"""Update affected historical test fixtures to the combined source contracts."""
from guarded_edit import edit, replace_once


def pet(source):
    source = replace_once(source, '{ characterId: "taki", kind: "expression", name: "smile" }', '{ characterId: "taki", commandId: "expression-test", kind: "expression", name: "smile" }')
    source = replace_once(source, '{ characterId: "taki", kind: "motion", name: "wave", priority: "normal" }', '{ characterId: "taki", commandId: "motion-test", kind: "motion", name: "wave", priority: "normal" }')
    source = replace_once(source, 'applyAvatarCommand: (command: AvatarCommand) => applied.push(command),',
        'applyAvatarCommand: async (command: AvatarCommand) => { applied.push(command); return { outcome: "applied" as const }; },')
    return replace_once(source, 'applyAvatarCommand: (command) => applied.push(command),',
        'applyAvatarCommand: async (command) => { applied.push(command); return { outcome: "applied" as const }; },')


def snapshot_fixture(source):
    source = replace_once(source, 'import { createRunSnapshotCapture }', 'import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";\nimport { createRunSnapshotCapture }')
    source = replace_once(source, 'memory: { createTools: () => ({}), snapshot: () => ({ providerId: "local", contractVersion: 1,',
        'memory: { captureRun: async () => ({ tools: {}, snapshot: createMemoryRunReference({ providerId: "local", contractVersion: 1,')
    return replace_once(source, 'vectorRetrieval: "unavailable", derivedMemoryRead: false } }) },',
        'vectorRetrieval: "unavailable", derivedMemoryRead: false } }) }) },')


def historical_035(source):
    source = replace_once(source, 'import { MIGRATIONS }', 'import { timelinePresentationMigration035 } from "./035-timeline-presentation.ts";\nimport { MIGRATIONS }')
    # The dedicated historical migration test still executes T4's original 035.
    # The combined-lineage matrix separately proves the canonical forward path.
    source = replace_once(source, 'const databases: Database[] = [];',
        'const historicalMigrations = [...MIGRATIONS.filter((migration) => migration.version <= 34), timelinePresentationMigration035];\nconst databases: Database[] = [];')
    return source.replace('migrations: MIGRATIONS,', 'migrations: historicalMigrations,')


edit('apps/desktop/src/windows/pet/restore-pet-connection.test.ts', pet)
edit('packages/core/src/agents/chat-agent-tool-names.test.ts', snapshot_fixture)
edit('packages/core/src/db/migrations/035-timeline-presentation.test.ts', historical_035)
edit('packages/core/src/db/migrations/lineage-reopen-matrix.test.ts', lambda s: replace_once(s,
    'const timeline035: Migration = { version: 35, sql: "ALTER TABLE timeline_messages ADD COLUMN presentation TEXT;" };',
    'const timeline035: Migration = timelinePresentationMigration035;'))
