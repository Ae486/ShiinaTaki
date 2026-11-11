# SQLite Transaction Failure Isolation

## 1. Scope / Trigger

Any change to `Database.transaction` or writes relying on nested savepoints, deferred constraints or SQLite's
transaction-ending conflict actions must preserve failure atomicity through the actual COMMIT/ROLLBACK boundary.

## 2. Signatures

`Database.transaction(fn: () => void): void` in `packages/core/src/db/sqlite.ts`; all `exec`, prepared statement
`run/get/all` and nested transaction entry points use the same wrapper. No async work belongs in the callback.

`Database.isTransaction` is a read-only getter over SQLite's actual state, including direct SQL BEGIN/SAVEPOINT.
It does not mutate or replace wrapper depth. Database decorators must delegate the getter; object spread alone
captures a stale boolean. Evidence memo owners may reuse committed evidence inside a transaction after a fresh
token check, but must not publish newly read evidence until no enclosing transaction remains. A pure reader
already inside a transaction uses that snapshot directly rather than starting another top-level BEGIN.

## 3. Contracts

Keep the entry `parentDepth` until COMMIT or savepoint RELEASE succeeds or rollback finishes; restore depth in
`finally`. COMMIT itself can fail after the callback returns. On a normal inner failure, rollback and release its
savepoint so the outer transaction can continue. SQLite can instead abort the whole transaction, for example with
`INSERT OR ROLLBACK`: while an outer logical boundary is still active, every wrapper SQL entry must refuse further
work if SQLite has ended it. This includes statements prepared earlier. Otherwise a caught inner error can let later
writes auto-commit before the outer COMMIT fails. Preserve the original failure and allow a new transaction only
after the enclosing boundary unwinds.

## 4. Validation & Error Matrix

| Failure | Required result |
| --- | --- |
| Callback / DDL / receipt failure | No partial rows, schema or receipt; depth restored |
| Deferred FK rejects COMMIT | Entire transaction rolled back; same connection remains usable |
| Caught ordinary inner savepoint failure | Inner writes rolled back; valid outer work may continue |
| SQLite aborts whole transaction inside a caught inner call | Later exec/prepared writes/nested calls cannot escape into auto-commit |

## 5. Good / Base / Bad Cases

- Good: a deferred-FK migration fails at COMMIT and leaves neither its new column nor migration receipt.
- Base: nested transactions succeed, or a caught inner savepoint failure leaves only valid outer writes.
- Bad: decrement depth before COMMIT and decrement it again when COMMIT throws, or continue SQL after an implicit
  SQLite rollback while the outer callback has not finished.

## 6. Tests Required

Use real SQLite deferred constraints, `INSERT OR ROLLBACK`, pre-prepared statements and nested transactions. Assert
schema/receipt/data rollback, prevented autocommit escape, preserved original errors and later connection usability.
Cover `exec`, new `prepare`, earlier statements' `run/get/all`, and another nested transaction after an implicit abort.

## 7. Wrong vs Correct

```ts
// Wrong: COMMIT failure enters catch after transaction depth was already decremented.
transactionDepth -= 1;
raw.exec("COMMIT");

// Correct: use the wrapper for the complete atomic operation, including nested repository writes.
db.transaction(() => {
  writeBusinessRows();
  writeReceipt();
});
// Its implementation keeps the captured parent boundary through commit/rollback, resets in finally,
// and refuses all SQL after SQLite implicitly aborts a still-active logical transaction.
```
