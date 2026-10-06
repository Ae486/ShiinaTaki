/** Parent-only read-only original retention receipt and full prepared-delta validation. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stableRequestHash } from '../../../../packages/core/src/db/canonical-memory-repo.ts';
import { memoryRetentionVerdict } from '../../../../packages/core/src/memory/retention-sweeper.ts';
import { readTransitionPreparation, readTransitionDeltaResult, validatePreparedDeltaResult } from '../../../../packages/core/src/db/memory-transition-delta-repo.ts';
import { getLayer } from '../../../../packages/core/src/memory/layer-registry.ts';
if(process.argv.slice(2).join(' ')!=='--verify-owned-copy'){console.log(JSON.stringify({executed:false,readOnly:true}));process.exit(0);}
const root='H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97';
const db=new DatabaseSync(root+'/application.sqlite',{readOnly:true});
const epochId='afb2053e-8bcd-4322-8573-0a447d560bb8';
const rows=db.prepare("SELECT * FROM canonical_memory_operation_receipts WHERE authority_epoch_id=? AND operation='invalidate'").all(epochId);
assert.equal(rows.length,68);const snapshot=db.prepare('SELECT record_json FROM canonical_memory_revision_snapshots WHERE authority_epoch_id=? AND bank_id=? AND memory_id=? AND revision=?');
for(const row of rows){
 const r=JSON.parse(row.result_json);assert.equal(r.outcome,'applied');assert.equal(r.revision,5);assert.equal(row.created_at,'2026-10-04T07:54:39.432Z');
 const base={epochId,bankId:r.bankId,memoryId:r.memoryId,expectedRevision:4};
 assert.equal(row.request_id,'retention:'+stableRequestHash({...base,verdict:'archive'}));
 assert.equal(row.request_hash,stableRequestHash(['canonical-local-maintenance.v1','invalidate',{...base,characterId:'taki',reason:'retention'}]));
 const before=JSON.parse(snapshot.get(epochId,r.bankId,r.memoryId,4).record_json);const after=JSON.parse(snapshot.get(epochId,r.bankId,r.memoryId,5).record_json);
 assert.equal(before.unit.state,'valid');assert.equal(after.unit.state,'invalidated');assert.equal(after.unit.invalidationReason,'retention');assert.deepEqual(before.policy,after.policy);
 const changed=Object.keys(before.unit).filter(k=>JSON.stringify(before.unit[k])!==JSON.stringify(after.unit[k])).sort();
 assert.deepEqual(changed,['invalidatedAt','invalidationReason','revision','state','updatedAt']);
 assert.equal(before.policy.layerId,'intentions');assert.equal(getLayer('intentions').retention,'expiring');
 assert.equal(before.policy.retention.kind,'expiring');assert.equal(typeof before.policy.retention.expiresAt,'string');
 assert.equal(memoryRetentionVerdict('expiring',{path:'readonly-audit',layer:'intentions',importance:before.policy.importance,createdAt:before.unit.createdAt,updatedAt:before.unit.updatedAt,expiresAt:before.policy.retention.expiresAt},{at:Date.parse(row.created_at),intentionsDefaultDays:30}),'archive');
}
const transition='6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53';const readOnly={prepare:(sql)=>db.prepare(sql)};
const preparedRows=db.prepare('SELECT id FROM memory_transition_preparations WHERE transition_id=?').all(transition);assert.equal(preparedRows.length,2);
for(const row of preparedRows){const p=readTransitionPreparation(readOnly,row.id);const delta=readTransitionDeltaResult(readOnly,transition,p.scope.localBankId);assert(delta);assert.equal(delta.preparationId,p.preparationId);validatePreparedDeltaResult(p,delta.result);}
db.close();console.log(JSON.stringify({verifiedPreparedDeltaResults:2,retentionReceiptHashes:68,revisionSnapshotPairs:68,explicitExpiryVerdicts:68,policyAndNonLifecycleFieldsPreserved:true,readOnly:true}));
