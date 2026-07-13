/**
 * INPUT:  a loaded Live2DModel's internal model (either Cubism 2.1 legacy or Cubism 3-5 modern).
 * OUTPUT: a ProbeCheck recording a raw parameter write->read round-trip, using each generation's native core-model API.
 * POS:    experimental / spike — not in production path; proves the raw-param access needed for head tracking / lip-sync (#14+).
 */

import { CubismLegacyInternalModel, CubismInternalModel, type InternalModel } from "untitled-pixi-live2d-engine";
import type { ProbeCheck } from "./spike-status.ts";

// Both generations expose an angle-X head parameter, but under different IDs and different core-model APIs.
const LEGACY_ANGLE_X = "PARAM_ANGLE_X";
const TEST_VALUE = 15;
const TOLERANCE = 0.5;

export function probeParamRoundTrip(internal: InternalModel): ProbeCheck {
  try {
    if (internal instanceof CubismLegacyInternalModel) {
      return roundTrip("legacy PARAM_ANGLE_X", (v) => {
        internal.coreModel.setParamFloat(LEGACY_ANGLE_X, v);
        return internal.coreModel.getParamFloat(LEGACY_ANGLE_X);
      });
    }
    if (internal instanceof CubismInternalModel) {
      const handle = internal.idParamAngleX;
      return roundTrip("modern ParamAngleX", (v) => {
        internal.coreModel.setParameterValueById(handle, v);
        return internal.coreModel.getParameterValueById(handle);
      });
    }
    return { ok: false, detail: "unknown internal model class — no known param API" };
  } catch (err) {
    return { ok: false, detail: `param round-trip threw: ${String(err)}` };
  }
}

function roundTrip(label: string, apply: (value: number) => number): ProbeCheck {
  const read = apply(TEST_VALUE);
  const ok = Math.abs(read - TEST_VALUE) <= TOLERANCE;
  return { ok, detail: `${label}: wrote ${TEST_VALUE}, read ${read.toFixed(3)}` };
}
