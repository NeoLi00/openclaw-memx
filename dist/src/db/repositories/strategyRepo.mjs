import { safeJsonParse } from "../../support.mjs";
//#region src/db/repositories/strategyRepo.ts
var StrategyRepo = class {
	db;
	constructor(db) {
		this.db = db;
	}
	upsert(record) {
		this.db.prepare(`INSERT INTO strategy_hypotheses(
          strategy_id, agent_id, scope, domain_key, summary, support_belief_ids_json, support_task_ids_json,
          confidence, usefulness_score, stability_score, contradiction_score, stage,
          derived_from_min_epoch, derived_from_max_epoch, materialized_epoch, derived_from_kind,
          derived_from_ids_json, derived_at_epoch, derivation_policy_version, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(strategy_id) DO UPDATE SET
          scope = excluded.scope,
          domain_key = excluded.domain_key,
          summary = excluded.summary,
          support_belief_ids_json = excluded.support_belief_ids_json,
          support_task_ids_json = excluded.support_task_ids_json,
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
          updated_at = excluded.updated_at`).run(record.strategyId, record.agentId, record.scope, record.domainKey, record.summary, JSON.stringify(record.supportBeliefIds), JSON.stringify(record.supportTaskIds), record.confidence, record.usefulnessScore, record.stabilityScore, record.contradictionScore, record.stage, record.derivedFromMinEpoch ?? 0, record.derivedFromMaxEpoch ?? 0, record.materializedEpoch ?? 0, record.derivedFromKind ?? null, JSON.stringify(record.derivedFromIds ?? []), record.derivedAtEpoch ?? 0, record.derivationPolicyVersion ?? null, JSON.stringify(record.metadataJson), record.createdAt, record.updatedAt);
	}
	listByAgent(params) {
		const values = [params.agentId];
		let sql = `
      SELECT strategy_id, agent_id, scope, domain_key, summary, support_belief_ids_json, support_task_ids_json,
             confidence, usefulness_score, stability_score, contradiction_score, stage,
             derived_from_min_epoch, derived_from_max_epoch, materialized_epoch, derived_from_kind,
             derived_from_ids_json, derived_at_epoch, derivation_policy_version, metadata_json, created_at, updated_at
        FROM strategy_hypotheses
       WHERE agent_id = ?
    `;
		if (params.scopes && params.scopes.length > 0) {
			sql += ` AND scope IN (${params.scopes.map(() => "?").join(", ")})`;
			values.push(...params.scopes);
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
		if (params.limit) sql += ` LIMIT ${Math.max(1, Math.trunc(params.limit))}`;
		return this.db.prepare(sql).all(...values).map((row) => this.toStrategy(row));
	}
	toStrategy(row) {
		return {
			strategyId: row.strategy_id,
			agentId: row.agent_id,
			scope: row.scope,
			domainKey: row.domain_key,
			summary: row.summary,
			supportBeliefIds: safeJsonParse(row.support_belief_ids_json, []),
			supportTaskIds: safeJsonParse(row.support_task_ids_json, []),
			confidence: row.confidence,
			usefulnessScore: row.usefulness_score,
			stabilityScore: row.stability_score,
			contradictionScore: row.contradiction_score,
			stage: row.stage,
			derivedFromMinEpoch: row.derived_from_min_epoch,
			derivedFromMaxEpoch: row.derived_from_max_epoch,
			materializedEpoch: row.materialized_epoch,
			derivedFromKind: row.derived_from_kind ?? void 0,
			derivedFromIds: safeJsonParse(row.derived_from_ids_json, []),
			derivedAtEpoch: row.derived_at_epoch,
			derivationPolicyVersion: row.derivation_policy_version ?? void 0,
			metadataJson: safeJsonParse(row.metadata_json, {}),
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}
};
//#endregion
export { StrategyRepo };
