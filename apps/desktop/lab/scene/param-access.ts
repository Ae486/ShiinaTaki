/**
 * INPUT:  a loaded model's internal model, duck-typed as { coreModel, idManager? } — Cubism 2 legacy or Cubism 3+ core.
 * OUTPUT: createParamAccess(internal) -> ParamAccess: generation tag + has/get/set/add/mult/listIds over raw parameters.
 * POS:    experimental / lab — not in production path; the ONE place the lab branches on model generation
 *         (spec live2d-renderer.md "Generation split"). Structural types only, so it is node-testable with fakes.
 */

export type Generation = "cubism2" | "cubism3";
export type WriteMode = "set" | "add" | "mult";

export interface ParamAccess {
  readonly generation: Generation;
  /** Whether the moc actually declares the id (see the per-generation caveats below). */
  has(id: string): boolean;
  get(id: string): number;
  set(id: string, value: number, weight?: number): void;
  add(id: string, value: number, weight?: number): void;
  mult(id: string, value: number, weight?: number): void;
  /** Cubism 3+ enumerates its parameter ids; Cubism 2 exposes no enumeration API -> null. */
  listIds(): string[] | null;
}

/** An opaque CubismIdHandle. The lab never inspects it, only round-trips it through the core model. */
type IdHandle = unknown;

interface IdManager {
  getId(id: string): IdHandle;
}

export interface ParamAccessTarget {
  coreModel: unknown;
  idManager?: IdManager;
}

/** Cubism 2 legacy core (Live2DModelWebGL): string-keyed. */
interface LegacyCore {
  setParamFloat(id: string, value: number, weight?: number): unknown;
  addToParamFloat(id: string, value: number, weight?: number): unknown;
  multParamFloat(id: string, value: number, weight?: number): unknown;
  getParamFloat(id: string): number;
  getParamIndex(id: string): number;
}

/** Cubism 3+ core (CubismModel): handle-keyed; handles come from the internal model's CubismIdManager. */
interface ModernCore {
  setParameterValueById(handle: IdHandle, value: number, weight?: number): void;
  addParameterValueById(handle: IdHandle, value: number, weight?: number): void;
  multiplyParameterValueById(handle: IdHandle, value: number, weight?: number): void;
  getParameterValueById(handle: IdHandle): number;
  getParameterCount(): number;
  getParameterId(index: number): { getString(): { s: string } };
}

export function createParamAccess(internal: ParamAccessTarget): ParamAccess {
  const core = internal.coreModel;
  if (isLegacyCore(core)) return legacyAccess(core);
  if (isModernCore(core) && internal.idManager !== undefined) return modernAccess(core, internal.idManager);
  throw new Error("lab param-access: core model exposes neither the Cubism 2 nor the Cubism 3 parameter API");
}

function legacyAccess(core: LegacyCore): ParamAccess {
  return {
    generation: "cubism2",
    // Cubism 2 auto-registers an unknown id on first touch, so a non-negative index is a weak signal — the readout
    // reports it, it is not proof the moc declares the parameter. The C3 branch below can answer honestly.
    has: (id) => core.getParamIndex(id) >= 0,
    get: (id) => finiteSample(core.getParamFloat(id)),
    // weight is passed explicitly on every write: both runtimes compute value*w + current*(1-w), and w=1 is the
    // documented default, so an explicit 1 keeps the two generations byte-identical for the same lab control.
    set: (id, value, weight = 1) => void core.setParamFloat(id, value, weight),
    add: (id, value, weight = 1) => void core.addToParamFloat(id, value, weight),
    mult: (id, value, weight = 1) => void core.multParamFloat(id, value, weight),
    listIds: () => null,
  };
}

function modernAccess(core: ModernCore, idManager: IdManager): ParamAccess {
  const handles = new Map<string, { value: IdHandle }>();
  const handle = (id: string): IdHandle => {
    const cached = handles.get(id) ?? { value: idManager.getId(id) };
    handles.set(id, cached);
    return cached.value;
  };
  // getParameterIndex REGISTERS an unknown id as a phantom parameter (verified in the 1.3.1 dist,
  // CubismModel#getParameterIndex), so `has` must answer from the declared list instead; a moc's list never changes.
  let declared: Set<string> | null = null;
  return {
    generation: "cubism3",
    has: (id) => (declared ??= new Set(enumerateIds(core))).has(id),
    get: (id) => finiteSample(core.getParameterValueById(handle(id))),
    set: (id, value, weight = 1) => core.setParameterValueById(handle(id), value, weight),
    add: (id, value, weight = 1) => core.addParameterValueById(handle(id), value, weight),
    mult: (id, value, weight = 1) => core.multiplyParameterValueById(handle(id), value, weight),
    listIds: () => enumerateIds(core),
  };
}

// Cubism 3 returns null for uninitialized phantom IDs despite its number return type. Never turn that into zero.
function finiteSample(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

// getParameterId returns a CubismIdHandle, not a string — the engine unwraps it the same way in getDrawableIDs.
function enumerateIds(core: ModernCore): string[] {
  const ids: string[] = [];
  for (let index = 0; index < core.getParameterCount(); index += 1) ids.push(core.getParameterId(index).getString().s);
  return ids;
}

function isLegacyCore(core: unknown): core is LegacyCore {
  return hasFunction(core, "setParamFloat");
}

function isModernCore(core: unknown): core is ModernCore {
  return hasFunction(core, "setParameterValueById");
}

function hasFunction(value: unknown, name: string): boolean {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[name] === "function";
}
