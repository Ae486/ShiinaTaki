/**
 * INPUT:  a universal mouth class and a measured character/costume profile.
 * OUTPUT: clamped plain parameter poses for the active Live2D rig; unsupported classes degrade explicitly.
 * POS:    experimental / lab — not in production path; measured profile data only, no engine imports and no global parameter constants.
 */

import type { MouthClass, MouthSample } from "./mouth-track.ts";

export type MouthGeneration = "cubism2" | "cubism3";
export type MouthPreview = "off" | "closed" | "a" | "e" | "i" | "o" | "u";

export interface MouthRange {
  readonly min: number;
  readonly max: number;
}

export interface MouthParameterIds {
  readonly open: string;
  readonly form?: string;
  readonly width?: string;
  readonly vertical?: string;
  readonly strength?: string;
}

export interface MouthPose {
  readonly open: number;
  readonly form?: number;
  readonly width?: number;
  readonly vertical?: number;
  readonly strength?: number;
}

export interface MouthProfile {
  readonly characterId: string;
  readonly costumeId: string;
  readonly generation: MouthGeneration;
  readonly ids: MouthParameterIds;
  readonly ranges: Readonly<Record<string, MouthRange>>;
  readonly poses: Readonly<Partial<Record<MouthClass, MouthPose>>>;
  readonly previews?: Readonly<Record<Exclude<MouthPreview, "off">, MouthPose>>;
}

export interface MappedMouthPose {
  readonly pose: MouthPose;
  readonly supported: boolean;
  readonly requested: MouthClass;
  readonly resolved: MouthClass;
}

export interface MouthParameterWrite {
  readonly id: string;
  readonly value: number;
}

const C2_ARBEIT: MouthProfile = {
  characterId: "taki",
  costumeId: "arbeit",
  generation: "cubism2",
  ids: { open: "PARAM_MOUTH_OPEN_Y", form: "PARAM_MOUTH_FORM_01", vertical: "PARAM_MOUTH_FORM_Y", width: "PARAM_MOUTH_SCALE" },
  ranges: {
    PARAM_MOUTH_OPEN_Y: { min: 0, max: 1 },
    PARAM_MOUTH_FORM_01: { min: -0.5, max: 1 },
    PARAM_MOUTH_FORM_Y: { min: -1, max: 1 },
    PARAM_MOUTH_SCALE: { min: -1, max: 1 },
  },
  poses: {
    rest: { open: 0, form: 0, width: 0, vertical: 0 },
    closed: { open: 0, form: 0, width: 0, vertical: 0 },
    open: { open: 0.8, form: 0 },
    wide: { open: 0.9, form: -0.5 },
    spread: { open: 0.25, form: 1 },
    rounded: { open: 0.65, form: -0.5, width: -0.65 },
    "narrow-rounded": { open: 0.45, form: -0.5, width: -1 },
    fricative: { open: 0.2, form: 0.3 },
  },
  previews: {
    closed: { open: 0 }, a: { open: 0.9, form: -0.5 }, e: { open: 0.4, form: 0 },
    i: { open: 0.22, form: 1 }, o: { open: 0.7, form: -0.5, width: -1 }, u: { open: 0.45, form: -0.5, width: -1 },
  },
};

const C3_LIVE_01: MouthProfile = {
  characterId: "taki",
  costumeId: "live_01",
  generation: "cubism3",
  ids: { open: "ParamMouthOpenY", form: "ParamMouthForm", width: "Param31", vertical: "ParamMouthupdawn", strength: "Param16" },
  ranges: {
    ParamMouthOpenY: { min: 0, max: 1 },
    ParamMouthForm: { min: -1, max: 1 },
    Param31: { min: -1, max: 1 },
    ParamMouthupdawn: { min: -1, max: 1 },
    Param16: { min: -1, max: 1 },
  },
  poses: {
    rest: { open: 0, form: 0, width: 0, vertical: 0, strength: 0 },
    closed: { open: 0, form: 0, width: 0, vertical: 0, strength: 0 },
    open: { open: 0.72, form: 0 },
    wide: { open: 0.9, form: 0 },
    spread: { open: 0.24, form: 1, width: 0.35 },
    rounded: { open: 0.6, form: -1, width: -0.35 },
    "narrow-rounded": { open: 0.46, form: -1, width: -1, strength: 0.25 },
    fricative: { open: 0.18, form: 0.35 },
  },
  previews: {
    closed: { open: 0 }, a: { open: 0.85, form: 0 }, e: { open: 0.35, form: 0.45 },
    i: { open: 0.22, form: 1 }, o: { open: 0.6, form: -1 }, u: { open: 0.48, form: -1, width: -1, strength: -1 },
  },
};

export function getMouthProfile(costumeId: string, characterId = "taki"): MouthProfile | null {
  if (characterId !== "taki") return null;
  if (costumeId === C2_ARBEIT.costumeId) return C2_ARBEIT;
  if (costumeId === C3_LIVE_01.costumeId) return C3_LIVE_01;
  return null;
}

export function mouthPreviewProfile(profile: MouthProfile, preview: Exclude<MouthPreview, "off">): MouthProfile {
  const pose = profile.previews?.[preview];
  if (pose === undefined) throw new Error("This costume has no calibrated preview for the selected pose.");
  return { ...profile, poses: { ...profile.poses, open: pose } };
}

export function hasMouthParameter(profile: MouthProfile, id: string): boolean {
  return Object.values(profile.ids).some((candidate) => candidate === id) && profile.ranges[id] !== undefined;
}

export function mapMouthSample(profile: MouthProfile, sample: MouthSample): MappedMouthPose {
  const requested = sample.mouth;
  const resolved = resolveClass(profile, requested);
  const base = { ...profile.poses.rest, ...profile.poses[resolved] };
  const scale = clamp01(sample.openness);
  const pose: MouthPose = {
    ...base,
    open: clampToRange(profile, profile.ids.open, (base.open ?? 0) * scale),
    ...(base.form === undefined || profile.ids.form === undefined ? {} : { form: clampToRange(profile, profile.ids.form, base.form) }),
    ...(base.width === undefined || profile.ids.width === undefined ? {} : { width: clampToRange(profile, profile.ids.width, base.width) }),
    ...(base.vertical === undefined || profile.ids.vertical === undefined ? {} : { vertical: clampToRange(profile, profile.ids.vertical, base.vertical) }),
    ...(base.strength === undefined || profile.ids.strength === undefined ? {} : { strength: clampToRange(profile, profile.ids.strength, base.strength) }),
  };
  return { pose, supported: profile.poses[requested] !== undefined, requested, resolved };
}

export function mouthPoseWrites(profile: MouthProfile, mapped: MappedMouthPose): MouthParameterWrite[] {
  const values: Partial<Record<keyof MouthPose, number>> = mapped.pose;
  const writes: MouthParameterWrite[] = [{ id: profile.ids.open, value: mapped.pose.open }];
  const optional: ReadonlyArray<[keyof MouthPose, string | undefined]> = [
    ["form", profile.ids.form],
    ["width", profile.ids.width],
    ["vertical", profile.ids.vertical],
    ["strength", profile.ids.strength],
  ];
  for (const [key, id] of optional) {
    const value = values[key];
    if (id !== undefined && value !== undefined) writes.push({ id, value });
  }
  return writes;
}

function resolveClass(profile: MouthProfile, requested: MouthClass): MouthClass {
  if (profile.poses[requested] !== undefined) return requested;
  if (requested === "unknown" || requested === "rest") return "rest";
  if (profile.poses.open !== undefined) return "open";
  return "rest";
}

function clampToRange(profile: MouthProfile, id: string, value: number): number {
  const range = profile.ranges[id];
  if (range === undefined) return value;
  return Math.max(range.min, Math.min(range.max, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
