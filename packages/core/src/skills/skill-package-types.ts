/**
 * INPUT: validated Skill lifecycle fields and immutable package-store records
 * OUTPUT: internal row, content, and catalog types shared by the Core Skill modules
 * POS:    core/skills private domain types; wire projections remain @taki/shared schemas
 */
import type { SkillScanFinding, SkillScanVerdict, SkillSourceKind, SkillTrust, SkillLifecycleState } from "@taki/shared";

export interface SkillContentFile { path: string; bytes: Buffer; }
export interface SkillPackageContent { packageId: string; skillName: string; description: string; hash: string; root: string; files: string[]; }
export interface SkillPackageRow {
  packageId: string; skillName: string | null; description: string | null; ownerHostId: string; contentHash: string | null;
  lifecycleState: SkillLifecycleState; enabled: boolean; sourceKind: SkillSourceKind; sourceLocator: string; trust: SkillTrust;
  scanVersion: string; scanVerdict: SkillScanVerdict; scanFindings: SkillScanFinding[]; failureReason: string | null;
  configRevision: number; createdAt: string; updatedAt: string;
}
