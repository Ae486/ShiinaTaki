/**
 * INPUT:  Core Database wrapper plus validated global-level/cell mutation requests
 * OUTPUT: createGovernancePolicyRepo(db) — atomic optimistic reads/writes over governance policy tables
 * POS:    core/governance — sole durable policy writer; material mutations increment once, no-ops increment zero
 */
import {
  GovernanceOverrideSchema,
  PermissionLevelSchema,
  type GovernanceOverride,
  type PermissionCellKey,
  type PermissionLevel,
  type PermissionPosture,
} from "@taki/shared";
import { z } from "zod";
import type { Database, SqlStatement } from "../db/sqlite.ts";

export interface GovernancePolicySnapshot {
  level: PermissionLevel;
  policyGeneration: number;
  registryRevision: number;
  overrides: GovernanceOverride[];
}

export class PolicyConflictError extends Error {
  readonly currentPolicyGeneration: number;
  constructor(currentPolicyGeneration: number) {
    super(`policy generation conflict; current generation is ${currentPolicyGeneration}`);
    this.name = "PolicyConflictError";
    this.currentPolicyGeneration = currentPolicyGeneration;
  }
}

export interface GovernancePolicyRepo {
  read(): GovernancePolicySnapshot;
  setLevel(level: PermissionLevel, expectedPolicyGeneration: number): GovernancePolicySnapshot;
  setOverride(input: {
    key: PermissionCellKey;
    level: PermissionLevel;
    posture: PermissionPosture | null;
    descriptorRevision: number;
    expectedPolicyGeneration: number;
  }): GovernancePolicySnapshot;
  reconcileRegistry(registryRevision: number, validOverrides: ReadonlySet<string>): GovernancePolicySnapshot;
}

const PolicyRowSchema = z.object({ level: PermissionLevelSchema, policy_generation: z.int().positive(), registry_revision: z.int().positive() });
const OverrideRowSchema = z.object({ cell_key: z.string(), level: PermissionLevelSchema, posture: z.enum(["auto", "ask", "deny"]), descriptor_revision: z.int().positive() });
const READ_POLICY = "SELECT level, policy_generation, registry_revision FROM governance_policy WHERE singleton_id = 1";
const READ_OVERRIDES = "SELECT cell_key, level, posture, descriptor_revision FROM governance_cell_overrides ORDER BY cell_key, level";

export function createGovernancePolicyRepo(db: Database): GovernancePolicyRepo {
  const statements = prepareStatements(db);
  return {
    read: () => readSnapshot(statements),
    setLevel(level, expectedPolicyGeneration) {
      mutate({ db, statements, expected: expectedPolicyGeneration, change: () => {
        const current = readPolicy(statements);
        if (current.level === level) return false;
        statements.setLevel.run({ level, updatedAt: new Date().toISOString() });
        return true;
      } });
      return readSnapshot(statements);
    },
    setOverride(input) {
      mutate({
        db,
        statements,
        expected: input.expectedPolicyGeneration,
        change: () => setOverride(statements, input),
      });
      return readSnapshot(statements);
    },
    reconcileRegistry(registryRevision, validOverrides) {
      db.transaction(() => reconcileRegistry(statements, registryRevision, validOverrides));
      return readSnapshot(statements);
    },
  };
}

interface Statements {
  readPolicy: SqlStatement;
  readOverrides: SqlStatement;
  readOverride: SqlStatement;
  setLevel: SqlStatement;
  upsertOverride: SqlStatement;
  deleteOverride: SqlStatement;
  deleteOverrideExact: SqlStatement;
  advance: SqlStatement;
  setRegistry: SqlStatement;
}

function prepareStatements(db: Database): Statements {
  return {
    readPolicy: db.prepare(READ_POLICY),
    readOverrides: db.prepare(READ_OVERRIDES),
    readOverride: db.prepare("SELECT posture, descriptor_revision FROM governance_cell_overrides WHERE cell_key = :key AND level = :level"),
    setLevel: db.prepare("UPDATE governance_policy SET level = :level, updated_at = :updatedAt WHERE singleton_id = 1"),
    upsertOverride: db.prepare("INSERT INTO governance_cell_overrides (cell_key, level, posture, descriptor_revision, updated_at) VALUES (:key,:level,:posture,:descriptorRevision,:updatedAt) ON CONFLICT(cell_key, level) DO UPDATE SET posture=excluded.posture, descriptor_revision=excluded.descriptor_revision, updated_at=excluded.updated_at"),
    deleteOverride: db.prepare("DELETE FROM governance_cell_overrides WHERE cell_key = :key AND level = :level"),
    deleteOverrideExact: db.prepare("DELETE FROM governance_cell_overrides WHERE cell_key = :key AND level = :level AND descriptor_revision = :descriptorRevision"),
    advance: db.prepare("UPDATE governance_policy SET policy_generation = policy_generation + 1, updated_at = :updatedAt WHERE singleton_id = 1"),
    setRegistry: db.prepare("UPDATE governance_policy SET registry_revision = :registryRevision, policy_generation = policy_generation + 1, updated_at = :updatedAt WHERE singleton_id = 1"),
  };
}

function readPolicy(statements: Statements) {
  const row = statements.readPolicy.get();
  if (!row) throw new Error("governance policy singleton is missing");
  return PolicyRowSchema.parse(row);
}

function readSnapshot(statements: Statements): GovernancePolicySnapshot {
  const policy = readPolicy(statements);
  const overrides = statements.readOverrides.all().map((raw) => {
    const row = OverrideRowSchema.parse(raw);
    return GovernanceOverrideSchema.parse({ key: row.cell_key, level: row.level, posture: row.posture, descriptorRevision: row.descriptor_revision });
  });
  return { level: policy.level, policyGeneration: policy.policy_generation, registryRevision: policy.registry_revision, overrides };
}

function mutate(input: { db: Database; statements: Statements; expected: number; change: () => boolean }): void {
  input.db.transaction(() => {
    const current = readPolicy(input.statements);
    if (current.policy_generation !== input.expected) throw new PolicyConflictError(current.policy_generation);
    if (input.change()) input.statements.advance.run({ updatedAt: new Date().toISOString() });
  });
}

function setOverride(statements: Statements, input: Parameters<GovernancePolicyRepo["setOverride"]>[0]): boolean {
  const current = statements.readOverride.get({ key: input.key, level: input.level });
  if (input.posture === null) return statements.deleteOverride.run({ key: input.key, level: input.level }).changes > 0;
  const parsed = current ? z.object({ posture: z.string(), descriptor_revision: z.int() }).parse(current) : undefined;
  if (parsed?.posture === input.posture && parsed.descriptor_revision === input.descriptorRevision) return false;
  statements.upsertOverride.run({ key: input.key, level: input.level, posture: input.posture, descriptorRevision: input.descriptorRevision, updatedAt: new Date().toISOString() });
  return true;
}

function reconcileRegistry(statements: Statements, registryRevision: number, validOverrides: ReadonlySet<string>): void {
  const current = readPolicy(statements);
  if (current.registry_revision > registryRevision) throw new Error(`database governance registry ${current.registry_revision} is newer than code ${registryRevision}`);
  if (current.registry_revision === registryRevision) return;
  for (const raw of statements.readOverrides.all()) {
    const row = OverrideRowSchema.parse(raw);
    if (!validOverrides.has(overrideIdentity({
      key: row.cell_key,
      level: row.level,
      posture: row.posture,
      descriptorRevision: row.descriptor_revision,
    }))) {
      statements.deleteOverrideExact.run({ key: row.cell_key, level: row.level, descriptorRevision: row.descriptor_revision });
    }
  }
  statements.setRegistry.run({ registryRevision, updatedAt: new Date().toISOString() });
}

export function overrideIdentity(input: { key: string; level: string; posture: string; descriptorRevision: number }): string {
  return `${input.key}\u0000${input.level}\u0000${input.posture}\u0000${input.descriptorRevision}`;
}
