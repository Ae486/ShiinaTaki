Updated only [native-smoke.mjs](/H:/TakiAgent/.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:552).

```diff
@@ -563,2 +563,3 @@
       let operation; let syncAttempts = 0; const attempts = [];
+      let checkpointAdvanced = false;
       do {
```

L564: Track checkpoint progress separately for each attempt.

```diff
@@ -574,2 +575,6 @@
-        attempts.push({ ...brief(operation), before, after: progress.get(bank.bankId) ?? null });
-      } while (["HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_REPLICA_BUSY", "HINDSIGHT_TIMEOUT"].includes(operation.errorCode) && Date.now() < leaseDeadline);
+        const after = progress.get(bank.bankId) ?? null;
+        attempts.push({ ...brief(operation), before, after });
+        checkpointAdvanced = before !== null && after !== null
+          && (after.native_cursor > before.native_cursor || after.state_cursor > before.state_cursor);
+      } while ((["HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_REPLICA_BUSY", "HINDSIGHT_TIMEOUT"].includes(operation.errorCode)
+        || (operation.errorCode === "HINDSIGHT_DEADLINE_EXCEEDED" && checkpointAdvanced)) && Date.now() < leaseDeadline);
```

L575–580: Continue deadline failures only after strict cursor advancement; preserve attempt records and existing bounds.

`node --check` passed on Node v24.18.0. Journey not run; file contents outside the function verified unchanged.