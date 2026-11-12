import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

function inventory(text) {
  const source = ts.createSourceFile("index.ts", text, ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0);
  const entries = new Set();
  const modules = new Set();
  for (const statement of source.statements) {
    assert(ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isNamedExports(statement.exportClause));
    const module = statement.moduleSpecifier.text;
    modules.add(module);
    for (const entry of statement.exportClause.elements) {
      entries.add(JSON.stringify([module, entry.propertyName?.text ?? entry.name.text, entry.name.text,
        Boolean(statement.isTypeOnly || entry.isTypeOnly)]));
    }
  }
  return { entries, modules, statements: source.statements.length };
}

const main = inventory(execFileSync("git", ["show", "9b98794a673efb561682b9fd451fe1da2db95086:packages/shared/src/index.ts"], { encoding: "utf8" }));
const t4 = inventory(execFileSync("git", ["show", "63faf8119be1747b685aacf43529d754626ab35c:packages/shared/src/index.ts"], { encoding: "utf8" }));
const current = inventory(readFileSync("packages/shared/src/index.ts", "utf8"));
const expected = new Set([...main.entries, ...t4.entries]);
const missing = [...expected].filter((entry) => !current.entries.has(entry));
assert.deepEqual(missing, []);
assert.equal(current.statements, current.modules.size);
console.log(JSON.stringify({ main: main.entries.size, t4: t4.entries.size, union: expected.size,
  current: current.entries.size, sourceModules: current.modules.size, missing: missing.length,
  sourceOnlyNamedExports: true }));
