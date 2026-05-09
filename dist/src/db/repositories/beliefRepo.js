import { safeJsonParse } from "../../support.js";
export class BeliefRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(record) {
        this.db
            .prepare(`INSERT INTO memory_beliefs(
          belief_id, agent_id, scope, memory_kind, content_ref, semantic_key, stage,
          prior_confidence, posterior_confidence, usefulness_score, stability_score,
          contradiction_score, outcome_support_score, source_reliability, first_seen_at,
          last_seen_at, last_used_at, use_count, reevaluation_due_at, derived_from_min_epoch,
          derived_from_max_epoch, materialized_epoch, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(belief_id) DO UPDATE SET
          scope = excluded.scope,
          stage = excluded.stage,
          prior_confidence = excluded.prior_confidence,
          posterior_confidence = excluded.posterior_confidence,
          usefulness_score = excluded.usefulness_score,
          stability_score = excluded.stability_score,
          contradiction_score = excluded.contradiction_score,
          outcome_support_score = excluded.outcome_support_score,
          source_reliability = excluded.source_reliability,
          first_seen_at = excluded.first_seen_at,
          last_seen_at = excluded.last_seen_at,
          last_used_at = excluded.last_used_at,
          use_count = excluded.use_count,
          reevaluation_due_at = excluded.reevaluation_due_at,
          derived_from_min_epoch = excluded.derived_from_min_epoch,
          derived_from_max_epoch = excluded.derived_from_max_epoch,
          materialized_epoch = excluded.materialized_epoch,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`)
            .run(record.beliefId, record.agentId, record.scope, record.memoryKind, record.contentRef ?? null, record.semanticKey, record.stage, record.priorConfidence, record.posteriorConfidence, record.usefulnessScore, record.stabilityScore, record.contradictionScore, record.outcomeSupportScore, record.sourceReliability, record.firstSeenAt, record.lastSeenAt, record.lastUsedAt ?? null, record.useCount, record.reevaluationDueAt ?? null, record.derivedFromMinEpoch ?? 0, record.derivedFromMaxEpoch ?? 0, record.materializedEpoch ?? 0, JSON.stringify(record.metadataJson), record.createdAt, record.updatedAt);
    }
    listByAgent(params) {
        const values = [params.agentId];
        let sql = `
      SELECT belief_id, agent_id, scope, memory_kind, content_ref, semantic_key, stage,
             prior_confidence, posterior_confidence, usefulness_score, stability_score,
             contradiction_score, outcome_support_score, source_reliability, first_seen_at,
             last_seen_at, last_used_at, use_count, reevaluation_due_at, derived_from_min_epoch,
             derived_from_max_epoch, materialized_epoch, metadata_json, created_at, updated_at
        FROM memory_beliefs
       WHERE agent_id = ?
    `;
        if (typeof params.readEpoch === "number") {
            sql += " AND materialized_epoch <= ?";
            values.push(params.readEpoch);
        }
        sql += " ORDER BY updated_at DESC, rowid DESC";
        if (params.limit) {
            sql += ` LIMIT ${Math.max(1, Math.trunc(params.limit))}`;
        }
        return this.db.prepare(sql).all(...values).map((row) => this.toBelief(row));
    }
    /**
     * Mark all active/probationary beliefs whose contentRef matches a superseded fact as superseded.
     * Returns the number of beliefs updated.
     */
    markSupersededByContentRef(params) {
        const result = this.db
            .prepare(`UPDATE memory_beliefs
            SET stage = 'superseded', updated_at = ?
          WHERE agent_id = ?
            AND content_ref = ?
            AND stage IN ('active', 'probationary', 'candidate')`)
            .run(params.updatedAt, params.agentId, params.contentRef);
        return Number(result.changes ?? 0);
    }
    getById(beliefId) {
        const row = this.db
            .prepare(`SELECT belief_id, agent_id, scope, memory_kind, content_ref, semantic_key, stage,
                prior_confidence, posterior_confidence, usefulness_score, stability_score,
                contradiction_score, outcome_support_score, source_reliability, first_seen_at,
                last_seen_at, last_used_at, use_count, reevaluation_due_at, derived_from_min_epoch,
                derived_from_max_epoch, materialized_epoch, metadata_json, created_at, updated_at
           FROM memory_beliefs
          WHERE belief_id = ?`)
            .get(beliefId);
        return row ? this.toBelief(row) : undefined;
    }
    toBelief(row) {
        return {
            beliefId: row.belief_id,
            agentId: row.agent_id,
            scope: row.scope,
            memoryKind: row.memory_kind,
            contentRef: row.content_ref ?? undefined,
            semanticKey: row.semantic_key,
            stage: row.stage,
            priorConfidence: row.prior_confidence,
            posteriorConfidence: row.posterior_confidence,
            usefulnessScore: row.usefulness_score,
            stabilityScore: row.stability_score,
            contradictionScore: row.contradiction_score,
            outcomeSupportScore: row.outcome_support_score,
            sourceReliability: row.source_reliability,
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            lastUsedAt: row.last_used_at ?? undefined,
            useCount: row.use_count,
            reevaluationDueAt: row.reevaluation_due_at ?? undefined,
            derivedFromMinEpoch: row.derived_from_min_epoch,
            derivedFromMaxEpoch: row.derived_from_max_epoch,
            materializedEpoch: row.materialized_epoch,
            metadataJson: safeJsonParse(row.metadata_json, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
