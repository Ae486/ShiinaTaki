/**
 * INPUT:  parsed expression JSON in either shape — Cubism 2 `.exp.json` { params: [{ id, val, calc? }] } or Cubism 3
 *         `.exp3.json` { Parameters: [{ Id, Value, Blend }] }.
 * OUTPUT: parseExpressionFile(json) -> FaceParam[] { id, value, calc, blend }; deriveFaceSet(entries, { excludeMult })
 *         -> deduped id list = the face parameters a body motion must relinquish (ignoreParamIds).
 * POS:    experimental / lab — not in production path; pure, node-testable, no engine imports. `calc` is the EFFECTIVE
 *         runtime mode: C2 normalizes declared add/mult values but then SETS every parameter; C3 only recognises the
 *         strings "Add" | "Multiply" | "Overwrite", so numeric Blend (1 / 2) runs as add. `blend` keeps the raw declaration.
 */

export type FaceCalc = "add" | "mult" | "set";

export interface FaceParam {
  id: string;
  value: number;
  calc: FaceCalc;
  /** Raw declaration: C2 `calc` string, C3 `Blend` (numeric in all imported costumes); undefined when omitted. */
  blend: string | number | undefined;
}

export function parseExpressionFile(json: unknown): FaceParam[] {
  if (typeof json !== "object" || json === null) return [];
  if ("params" in json && Array.isArray(json.params)) return json.params.map(parseCubism2).filter(isFaceParam);
  if ("Parameters" in json && Array.isArray(json.Parameters)) return json.Parameters.map(parseCubism3).filter(isFaceParam);
  return [];
}

export function deriveFaceSet(entries: readonly FaceParam[], options: { excludeMult?: boolean } = {}): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (options.excludeMult === true && isDeclaredMult(entry)) continue;
    ids.add(entry.id);
  }
  return [...ids];
}

// The eye-open switch concerns the file's declaration, not the C2 engine's effective set operation.
export function isDeclaredMult(entry: FaceParam): boolean {
  return entry.blend === "mult" || entry.blend === "Multiply";
}

function parseCubism2(raw: unknown): FaceParam | null {
  if (typeof raw !== "object" || raw === null || !("id" in raw) || typeof raw.id !== "string") return null;
  const calc = "calc" in raw ? raw.calc : undefined;
  const value = "val" in raw && typeof raw.val === "number" ? raw.val : Number.NaN;
  const defaultValue = "def" in raw && typeof raw.def === "number" ? raw.def : 0;
  return {
    id: raw.id,
    value: normalizeCubism2Value(value, calc, defaultValue),
    calc: "set",
    blend: typeof calc === "string" ? calc : undefined,
  };
}

// Live2DExpression's constructor uses `def || 0/1`; updateParamExe ignores calc and calls setParamFloat(val * weight).
function normalizeCubism2Value(value: number, calc: unknown, defaultValue: number): number {
  if (!calc || calc === "add") return value - (defaultValue || 0);
  if (calc === "mult") return value / (defaultValue || 1);
  return value;
}

function parseCubism3(raw: unknown): FaceParam | null {
  if (typeof raw !== "object" || raw === null || !("Id" in raw) || typeof raw.Id !== "string") return null;
  const blend = "Blend" in raw ? raw.Blend : undefined;
  return {
    id: raw.Id,
    value: "Value" in raw && typeof raw.Value === "number" ? raw.Value : 0,
    calc: effectiveCubism3Calc(blend),
    blend: typeof blend === "string" || typeof blend === "number" ? blend : undefined,
  };
}

// Mirrors CubismExpressionMotion.parse: exact string match or Additive fallback — numeric 2 is NOT Multiply at runtime.
function effectiveCubism3Calc(blend: unknown): FaceCalc {
  if (blend === "Multiply") return "mult";
  if (blend === "Overwrite") return "set";
  return "add";
}

function isFaceParam(entry: FaceParam | null): entry is FaceParam {
  return entry !== null;
}
