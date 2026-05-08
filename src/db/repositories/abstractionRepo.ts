import { safeJsonParse } from "../../support.js";
import type { AbstractionCandidateRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type AbstractionRow = {
  candidate_id: string;
  agent_id: string;
  scope: string;
  abstraction_type: AbstractionCandidateRecord["abstractionType"];
  semantic_key: string;
  summary: string;
  support_content_refs_json: string;
  support_belief_ids_json: string;
  confidence: number;
  usefulness_score: number;
  stability_score: number;
  contradiction_score: number;
  stage: AbstractionCandidateRecord["stage"];
  derived_from_min_epoch: number;
  derived_from_max_epoch: number;
  materialized_epoch: number;
  derived_from_kind: string | null;
  derived_from_ids_json: string;
  derived_at_epoch: number;
  derivation_policy_version: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

export class AbstractionRepo {
  constructor(private readonly db: MemxDbClient) {}

  upsert(record: AbstractionCandidateRecord): void {
    this.db
      .prepare(
        `INSERT INTO abstraction_candidates(
          candidate_id, agent_id, scope, abstraction_type, semantic_key, summary,
          support_content_refs_json, support_belief_ids_json, confidence, usefulness_score,
          stability_score, contradiction_score, stage, derived_from_min_epoch, derived_from_max_epoch,
          materialized_epoch, derived_from_kind, derived_from_ids_json, derived_at_epoch,
          derivation_policy_version, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET
          scope = excluded.scope,
          abstraction_type = excluded.abstraction_type,
          semantic_key = excluded.semantic_key,
          summary = excluded.summary,
          support_content_refs_json = excluded.support_content_refs_json,
          support_belief_ids_json = excluded.support_belief_ids_json,
          confidence = excluded.confidence,
          usefulness_score = excluded.usefulness_score,
          stability_score = excluded.stability_score,
          contradiction_score = excluded.contradiction_score,
          stage = excluded.stage,
          derived_from_min_epoch = excluded.derived_from_min_epoch,
          derived_from_max_epoch = excluded.derived_from_max_epoch,
          materialized_epoch = excluded.materialized_epoch,
          derived_from_kind = excluded.derived_from_kind,
          derived_from_ids_json = excluded.derived_from_ids_json,
          derived_at_epoch = excluded.derived_at_epoch,
          derivation_policy_version = excluded.derivation_policy_version,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.candidateId,
        record.agentId,
        record.scope,
        record.abstractionType,
        record.semanticKey,
        record.summary,
        JSON.stringify(record.supportContentRefs),
        JSON.stringify(record.supportBeliefIds),
        record.confidence,
        record.usefulnessScore,
        record.stabilityScore,
        record.contradictionScore,
        record.stage,
        record.derivedFromMinEpoch ?? 0,
        record.derivedFromMaxEpoch ?? 0,
        record.materializedEpoch ?? 0,
        record.derivedFromKind ?? null,
        JSON.stringify(record.derivedFromIds ?? []),
        record.derivedAtEpoch ?? 0,
        record.derivationPolicyVersion ?? null,
        JSON.stringify(record.metadataJson),
        record.createdAt,
        record.updatedAt,
      );
  }

  listByAgent(params: {
    agentId: string;
    scopes?: string[];
    abstractionTypes?: AbstractionCandidateRecord["abstractionType"][];
    stages?: AbstractionCandidateRecord["stage"][];
    limit?: number;
    readEpoch?: number;
  }): AbstractionCandidateRecord[] {
    const values: Array<string | number> = [params.agentId];
    let sql = `
      SELECT candidate_id, agent_id, scope, abstraction_type, semantic_key, summary,
             support_content_refs_json, support_belief_ids_json, confidence, usefulness_score,
             stability_score, contradiction_score, stage, derived_from_min_epoch, derived_from_max_epoch,
             materialized_epoch, derived_from_kind, derived_from_ids_json, derived_at_epoch,
             derivation_policy_version, metadata_json, created_at, updated_at
        FROM abstraction_candidates
       WHERE agent_id = ?
    `;
    if (params.scopes && params.scopes.length > 0) {
      sql += ` AND scope IN (${params.scopes.map(() => "?").join(", ")})`;
      values.push(...params.scopes);
    }
    if (params.abstractionTypes && params.abstractionTypes.length > 0) {
      sql += ` AND abstraction_type IN (${params.abstractionTypes.map(() => "?").join(", ")})`;
      values.push(...params.abstractionTypes);
    }
    if (params.stages && params.stages.length > 0) {
      sql += ` AND stage IN (${params.stages.map(() => "?").join(", ")})`;
      values.push(...params.stages);
    }
    if (typeof params.readEpoch === "number") {
      sql += " AND materialized_epoch <= ?";
      values.push(params.readEpoch);
    }
    sql += " ORDER BY confidence DESC, usefulness_score DESC, updated_at DESC";
    if (params.limit) {
      sql += ` LIMIT ${Math.max(1, Math.trunc(params.limit))}`;
    }
    return (this.db.prepare(sql).all(...values) as AbstractionRow[]).map((row) =>
      this.toCandidate(row),
    );
  }

  getById(candidateId: string): AbstractionCandidateRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT candidate_id, agent_id, scope, abstraction_type, semantic_key, summary,
                support_content_refs_json, support_belief_ids_json, confidence, usefulness_score,
                stability_score, contradiction_score, stage, derived_from_min_epoch, derived_from_max_epoch,
                materialized_epoch, derived_from_kind, derived_from_ids_json, derived_at_epoch,
                derivation_policy_version, metadata_json, created_at, updated_at
           FROM abstraction_candidates
          WHERE candidate_id = ?`,
      )
      .get(candidateId) as AbstractionRow | undefined;
    return row ? this.toCandidate(row) : undefined;
  }

  countByAgent(params: {
    agentId: string;
    stages?: AbstractionCandidateRecord["stage"][];
  }): number {
    const values: Array<string | number> = [params.agentId];
    let sql = `
      SELECT COUNT(*) AS count
        FROM abstraction_candidates
       WHERE agent_id = ?
    `;
    if (params.stages && params.stages.length > 0) {
      sql += ` AND stage IN (${params.stages.map(() => "?").join(", ")})`;
      values.push(...params.stages);
    }
    return Number(
      (this.db.prepare(sql).get(...values) as { count: number } | undefined)?.count ?? 0,
    );
  }

  private toCandidate(row: AbstractionRow): AbstractionCandidateRecord {
    return {
      candidateId: row.candidate_id,
      agentId: row.agent_id,
      scope: row.scope,
      abstractionType: row.abstraction_type,
      semanticKey: row.semantic_key,
      summary: row.summary,
      supportContentRefs: safeJsonParse<string[]>(row.support_content_refs_json, []),
      supportBeliefIds: safeJsonParse<string[]>(row.support_belief_ids_json, []),
      confidence: row.confidence,
      usefulnessScore: row.usefulness_score,
      stabilityScore: row.stability_score,
      contradictionScore: row.contradiction_score,
      stage: row.stage,
      derivedFromMinEpoch: row.derived_from_min_epoch,
      derivedFromMaxEpoch: row.derived_from_max_epoch,
      materializedEpoch: row.materialized_epoch,
      derivedFromKind: row.derived_from_kind ?? undefined,
      derivedFromIds: safeJsonParse<string[]>(row.derived_from_ids_json, []),
      derivedAtEpoch: row.derived_at_epoch,
      derivationPolicyVersion: row.derivation_policy_version ?? undefined,
      metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
