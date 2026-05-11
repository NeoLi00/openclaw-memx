import { nowIso } from "../../support.mjs";
//#region src/db/repositories/maintenanceRepo.ts
function parseTurnIds(raw) {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string" && value.trim().length > 0) : [];
	} catch {
		return [];
	}
}
function stringifyTurnIds(turnIds) {
	return JSON.stringify(turnIds);
}
function mergeUniqueTurnIds(left, right) {
	const merged = new Set(left);
	for (const turnId of right) if (turnId.trim()) merged.add(turnId);
	return [...merged];
}
function minIso(values) {
	const filtered = values.filter((value) => Boolean(value));
	if (filtered.length === 0) return;
	return filtered.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest);
}
function maxIso(values) {
	const filtered = values.filter((value) => Boolean(value));
	if (filtered.length === 0) return;
	return filtered.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}
function toStateRecord(row) {
	return {
		agentId: row.agent_id,
		sessionKey: row.session_key,
		pendingTurnCount: row.pending_turn_count,
		pendingTurnIds: parseTurnIds(row.pending_turn_ids_json),
		firstPendingObservedAt: row.first_pending_observed_at ?? void 0,
		lastPendingObservedAt: row.last_pending_observed_at ?? void 0,
		inflightTurnCount: row.inflight_turn_count,
		inflightTurnIds: parseTurnIds(row.inflight_turn_ids_json),
		inflightReason: row.inflight_reason === "threshold" || row.inflight_reason === "idle" || row.inflight_reason === "shutdown" ? row.inflight_reason : void 0,
		inflightStartedAt: row.inflight_started_at ?? void 0,
		inflightFirstObservedAt: row.inflight_first_observed_at ?? void 0,
		inflightLastObservedAt: row.inflight_last_observed_at ?? void 0,
		lastEventWatermark: row.last_event_watermark ?? void 0,
		lastSignalWatermark: row.last_signal_watermark ?? void 0,
		lastTaskWatermark: row.last_task_watermark ?? void 0,
		status: row.status,
		leaseOwner: row.lease_owner ?? void 0,
		leaseExpiresAt: row.lease_expires_at ?? void 0,
		lastCompletedAt: row.last_completed_at ?? void 0,
		updatedAt: row.updated_at
	};
}
function rowDefaults(params) {
	return {
		agent_id: params.agentId,
		session_key: params.sessionKey,
		pending_turn_count: 0,
		pending_turn_ids_json: "[]",
		first_pending_observed_at: null,
		last_pending_observed_at: null,
		inflight_turn_count: 0,
		inflight_turn_ids_json: "[]",
		inflight_reason: null,
		inflight_started_at: null,
		inflight_first_observed_at: null,
		inflight_last_observed_at: null,
		last_event_watermark: null,
		last_signal_watermark: null,
		last_task_watermark: null,
		status: "idle",
		lease_owner: null,
		lease_expires_at: null,
		last_completed_at: null,
		updated_at: params.updatedAt
	};
}
var MaintenanceRepo = class {
	db;
	constructor(db) {
		this.db = db;
	}
	getState(agentId, sessionKey) {
		const row = this.db.prepare(`SELECT agent_id, session_key, pending_turn_count, pending_turn_ids_json,
                first_pending_observed_at, last_pending_observed_at,
                inflight_turn_count, inflight_turn_ids_json, inflight_reason,
                inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
                last_event_watermark, last_signal_watermark, last_task_watermark,
                status, lease_owner, lease_expires_at, last_completed_at, updated_at
           FROM maintenance_scheduler_state
          WHERE agent_id = ?
            AND session_key = ?`).get(agentId, sessionKey);
		return row ? toStateRecord(row) : null;
	}
	listPendingStates() {
		return this.db.prepare(`SELECT agent_id, session_key, pending_turn_count, pending_turn_ids_json,
                first_pending_observed_at, last_pending_observed_at,
                inflight_turn_count, inflight_turn_ids_json, inflight_reason,
                inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
                last_event_watermark, last_signal_watermark, last_task_watermark,
                status, lease_owner, lease_expires_at, last_completed_at, updated_at
           FROM maintenance_scheduler_state
          WHERE pending_turn_count > 0
             OR inflight_turn_count > 0`).all().map((row) => toStateRecord(row));
	}
	recordPendingTurn(params) {
		const updatedAt = params.updatedAt ?? nowIso();
		return this.db.withTransaction(() => {
			const current = this.db.prepare(`SELECT agent_id, session_key, pending_turn_count, pending_turn_ids_json,
                    first_pending_observed_at, last_pending_observed_at,
                    inflight_turn_count, inflight_turn_ids_json, inflight_reason,
                    inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
                    last_event_watermark, last_signal_watermark, last_task_watermark,
                    status, lease_owner, lease_expires_at, last_completed_at, updated_at
               FROM maintenance_scheduler_state
              WHERE agent_id = ?
                AND session_key = ?`).get(params.agentId, params.sessionKey) ?? rowDefaults({
				agentId: params.agentId,
				sessionKey: params.sessionKey,
				updatedAt
			});
			const pendingTurnIds = parseTurnIds(current.pending_turn_ids_json);
			const inflightTurnIds = parseTurnIds(current.inflight_turn_ids_json);
			if (!pendingTurnIds.includes(params.turnId) && !inflightTurnIds.includes(params.turnId)) pendingTurnIds.push(params.turnId);
			const next = {
				...current,
				pending_turn_count: pendingTurnIds.length,
				pending_turn_ids_json: stringifyTurnIds(pendingTurnIds),
				first_pending_observed_at: minIso([current.first_pending_observed_at ?? void 0, params.observedAt]) ?? null,
				last_pending_observed_at: maxIso([current.last_pending_observed_at ?? void 0, params.observedAt]) ?? null,
				updated_at: updatedAt
			};
			this.persistRow(next);
			return toStateRecord(next);
		});
	}
	claimBatch(params) {
		return this.db.withTransaction(() => {
			let working = { ...this.db.prepare(`SELECT agent_id, session_key, pending_turn_count, pending_turn_ids_json,
                    first_pending_observed_at, last_pending_observed_at,
                    inflight_turn_count, inflight_turn_ids_json, inflight_reason,
                    inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
                    last_event_watermark, last_signal_watermark, last_task_watermark,
                    status, lease_owner, lease_expires_at, last_completed_at, updated_at
               FROM maintenance_scheduler_state
              WHERE agent_id = ?
                AND session_key = ?`).get(params.agentId, params.sessionKey) ?? rowDefaults({
				agentId: params.agentId,
				sessionKey: params.sessionKey,
				updatedAt: params.now
			}) };
			if (working.status === "running" && (!working.lease_expires_at || Date.parse(working.lease_expires_at) <= Date.parse(params.now))) {
				const mergedTurnIds = mergeUniqueTurnIds(parseTurnIds(working.pending_turn_ids_json), parseTurnIds(working.inflight_turn_ids_json));
				working = {
					...working,
					pending_turn_count: mergedTurnIds.length,
					pending_turn_ids_json: stringifyTurnIds(mergedTurnIds),
					first_pending_observed_at: minIso([working.first_pending_observed_at ?? void 0, working.inflight_first_observed_at ?? void 0]) ?? null,
					last_pending_observed_at: maxIso([working.last_pending_observed_at ?? void 0, working.inflight_last_observed_at ?? void 0]) ?? null,
					inflight_turn_count: 0,
					inflight_turn_ids_json: "[]",
					inflight_reason: null,
					inflight_started_at: null,
					inflight_first_observed_at: null,
					inflight_last_observed_at: null,
					status: "idle",
					lease_owner: null,
					lease_expires_at: null
				};
			}
			if (working.status === "running" && working.lease_expires_at && Date.parse(working.lease_expires_at) > Date.parse(params.now)) {
				this.persistRow({
					...working,
					updated_at: params.now
				});
				return null;
			}
			const turnIds = parseTurnIds(working.pending_turn_ids_json);
			if (turnIds.length === 0) {
				this.persistRow({
					...working,
					updated_at: params.now
				});
				return null;
			}
			const leaseExpiresAt = new Date(Date.parse(params.now) + params.leaseTtlMs).toISOString();
			const claimed = {
				...working,
				pending_turn_count: 0,
				pending_turn_ids_json: "[]",
				first_pending_observed_at: null,
				last_pending_observed_at: null,
				inflight_turn_count: turnIds.length,
				inflight_turn_ids_json: stringifyTurnIds(turnIds),
				inflight_reason: params.reason,
				inflight_started_at: params.now,
				inflight_first_observed_at: working.first_pending_observed_at,
				inflight_last_observed_at: working.last_pending_observed_at,
				status: "running",
				lease_owner: params.leaseOwner,
				lease_expires_at: leaseExpiresAt,
				updated_at: params.now
			};
			this.persistRow(claimed);
			return {
				agentId: params.agentId,
				sessionKey: params.sessionKey,
				turnIds,
				turnCount: turnIds.length,
				firstObservedAt: claimed.inflight_first_observed_at ?? void 0,
				lastObservedAt: claimed.inflight_last_observed_at ?? void 0,
				reason: params.reason,
				lowerWatermarks: {
					event: working.last_event_watermark ?? void 0,
					signal: working.last_signal_watermark ?? void 0,
					task: working.last_task_watermark ?? void 0
				}
			};
		});
	}
	finishBatch(params) {
		return this.db.withTransaction(() => {
			const current = this.db.prepare(`SELECT agent_id, session_key, pending_turn_count, pending_turn_ids_json,
                  first_pending_observed_at, last_pending_observed_at,
                  inflight_turn_count, inflight_turn_ids_json, inflight_reason,
                  inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
                  last_event_watermark, last_signal_watermark, last_task_watermark,
                  status, lease_owner, lease_expires_at, last_completed_at, updated_at
             FROM maintenance_scheduler_state
            WHERE agent_id = ?
              AND session_key = ?`).get(params.agentId, params.sessionKey);
			if (!current) return null;
			if (current.status === "running" && current.lease_owner && current.lease_owner !== params.leaseOwner) return toStateRecord(current);
			let next = { ...current };
			if (params.success) next = {
				...next,
				inflight_turn_count: 0,
				inflight_turn_ids_json: "[]",
				inflight_reason: null,
				inflight_started_at: null,
				inflight_first_observed_at: null,
				inflight_last_observed_at: null,
				status: "idle",
				lease_owner: null,
				lease_expires_at: null,
				last_event_watermark: maxIso([current.last_event_watermark ?? void 0, params.upperWatermarks?.event]) ?? null,
				last_signal_watermark: maxIso([current.last_signal_watermark ?? void 0, params.upperWatermarks?.signal]) ?? null,
				last_task_watermark: maxIso([current.last_task_watermark ?? void 0, params.upperWatermarks?.task]) ?? null,
				last_completed_at: params.completedAt,
				updated_at: params.completedAt
			};
			else {
				const mergedTurnIds = mergeUniqueTurnIds(parseTurnIds(current.pending_turn_ids_json), parseTurnIds(current.inflight_turn_ids_json));
				next = {
					...next,
					pending_turn_count: mergedTurnIds.length,
					pending_turn_ids_json: stringifyTurnIds(mergedTurnIds),
					first_pending_observed_at: minIso([current.first_pending_observed_at ?? void 0, current.inflight_first_observed_at ?? void 0]) ?? null,
					last_pending_observed_at: maxIso([current.last_pending_observed_at ?? void 0, current.inflight_last_observed_at ?? void 0]) ?? null,
					inflight_turn_count: 0,
					inflight_turn_ids_json: "[]",
					inflight_reason: null,
					inflight_started_at: null,
					inflight_first_observed_at: null,
					inflight_last_observed_at: null,
					status: "idle",
					lease_owner: null,
					lease_expires_at: null,
					updated_at: params.completedAt
				};
			}
			this.persistRow(next);
			return toStateRecord(next);
		});
	}
	persistRow(row) {
		this.db.prepare(`INSERT INTO maintenance_scheduler_state(
          agent_id, session_key, pending_turn_count, pending_turn_ids_json,
          first_pending_observed_at, last_pending_observed_at,
          inflight_turn_count, inflight_turn_ids_json, inflight_reason,
          inflight_started_at, inflight_first_observed_at, inflight_last_observed_at,
          last_event_watermark, last_signal_watermark, last_task_watermark,
          status, lease_owner, lease_expires_at, last_completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, session_key) DO UPDATE SET
          pending_turn_count = excluded.pending_turn_count,
          pending_turn_ids_json = excluded.pending_turn_ids_json,
          first_pending_observed_at = excluded.first_pending_observed_at,
          last_pending_observed_at = excluded.last_pending_observed_at,
          inflight_turn_count = excluded.inflight_turn_count,
          inflight_turn_ids_json = excluded.inflight_turn_ids_json,
          inflight_reason = excluded.inflight_reason,
          inflight_started_at = excluded.inflight_started_at,
          inflight_first_observed_at = excluded.inflight_first_observed_at,
          inflight_last_observed_at = excluded.inflight_last_observed_at,
          last_event_watermark = excluded.last_event_watermark,
          last_signal_watermark = excluded.last_signal_watermark,
          last_task_watermark = excluded.last_task_watermark,
          status = excluded.status,
          lease_owner = excluded.lease_owner,
          lease_expires_at = excluded.lease_expires_at,
          last_completed_at = excluded.last_completed_at,
          updated_at = excluded.updated_at`).run(row.agent_id, row.session_key, row.pending_turn_count, row.pending_turn_ids_json, row.first_pending_observed_at, row.last_pending_observed_at, row.inflight_turn_count, row.inflight_turn_ids_json, row.inflight_reason, row.inflight_started_at, row.inflight_first_observed_at, row.inflight_last_observed_at, row.last_event_watermark, row.last_signal_watermark, row.last_task_watermark, row.status, row.lease_owner, row.lease_expires_at, row.last_completed_at, row.updated_at);
	}
};
//#endregion
export { MaintenanceRepo };
