import { randomId, safeJsonParse, stableHash } from "../../support.js";
import type {
  MaintenanceRunRecord,
  MemoryPolicyDecision,
  MemorySignalEventRecord,
  RetrievalAuditRecord,
} from "../../types.js";
import type { MemxDbClient } from "../client.js";

export class AuditRepo {
  constructor(private readonly db: MemxDbClient) {}

  recordPolicyDecision(params: {
    agentId: string;
    sourceRef: string;
    candidateText: string;
    decision: MemoryPolicyDecision;
    createdAt: string;
    metadataJson?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO policy_decisions(
          decision_id, agent_id, source_ref, candidate_hash, salience_score, utility_score, chosen_action, reasons_json, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomId("decision"),
        params.agentId,
        params.sourceRef,
        stableHash([params.candidateText]),
        params.decision.salienceScore,
        params.decision.expectedFutureUtility,
        params.decision.action,
        JSON.stringify(params.decision.reasons),
        params.createdAt,
        JSON.stringify(params.metadataJson ?? {}),
      );
  }

  recordRetrieval(audit: RetrievalAuditRecord): void {
    this.db
      .prepare(
        `INSERT INTO retrieval_audit(
          audit_id, agent_id, scope, route_type, query_text, query_hash, selected_items_json, injected_chars, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        audit.auditId,
        audit.agentId,
        audit.scope,
        audit.routeType,
        audit.queryText,
        audit.queryHash,
        JSON.stringify(audit.selectedItemsJson),
        audit.injectedChars,
        audit.createdAt,
      );
  }

  annotateLatestRetrievalInjection(params: {
    agentId: string;
    queryText: string;
    actualInjectedChars: number;
    candidateChars: number;
    eligible: boolean;
    reason?: string;
    finalizedAt: string;
  }): void {
    const queryHash = stableHash([params.queryText]);
    const row = this.db
      .prepare(
        `SELECT audit_id, selected_items_json, injected_chars
           FROM retrieval_audit
          WHERE agent_id = ?
            AND query_hash = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT 1`,
      )
      .get(params.agentId, queryHash) as
      | { audit_id: string; selected_items_json: string; injected_chars: number }
      | undefined;
    if (!row) {
      return;
    }
    const selectedItems = safeJsonParse<Record<string, unknown>>(row.selected_items_json, {});
    selectedItems.nativeContextInjection = {
      candidateChars: params.candidateChars,
      actualInjectedChars: params.actualInjectedChars,
      eligible: params.eligible,
      reason: params.reason,
      finalizedAt: params.finalizedAt,
    };
    this.db
      .prepare(
        `UPDATE retrieval_audit
            SET selected_items_json = ?,
                injected_chars = ?
          WHERE audit_id = ?`,
      )
      .run(JSON.stringify(selectedItems), params.actualInjectedChars, row.audit_id);
  }

  recordSignal(signal: MemorySignalEventRecord): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_signal_events(
          signal_id, agent_id, scope, session_key, signal_type, memory_kind, content_ref, semantic_key, value, source_ref, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        signal.signalId,
        signal.agentId,
        signal.scope,
        signal.sessionKey ?? null,
        signal.signalType,
        signal.memoryKind,
        signal.contentRef ?? null,
        signal.semanticKey,
        signal.value,
        signal.sourceRef,
        JSON.stringify(signal.metadataJson),
        signal.createdAt,
      );
  }

  listSignals(params: {
    agentId: string;
    sessionKey?: string;
    signalTypes?: MemorySignalEventRecord["signalType"][];
    after?: string;
    until?: string;
    limit?: number;
  }): MemorySignalEventRecord[] {
    const values: Array<string | number> = [params.agentId];
    let sql = `
      SELECT signal_id, agent_id, scope, session_key, signal_type, memory_kind, content_ref, semantic_key, value,
             source_ref, metadata_json, created_at
        FROM memory_signal_events
       WHERE agent_id = ?
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    if (params.signalTypes && params.signalTypes.length > 0) {
      sql += ` AND signal_type IN (${params.signalTypes.map(() => "?").join(", ")})`;
      values.push(...params.signalTypes);
    }
    if (params.after) {
      sql += " AND created_at > ?";
      values.push(params.after);
    }
    if (params.until) {
      sql += " AND created_at <= ?";
      values.push(params.until);
    }
    sql += " ORDER BY created_at ASC, rowid ASC";
    if (params.limit) {
      sql += ` LIMIT ${Math.max(1, Math.trunc(params.limit))}`;
    }
    return this.db
      .prepare(sql)
      .all(...values)
      .map((row) => {
        const record = row as {
          signal_id: string;
          agent_id: string;
          scope: string;
          session_key: string | null;
          signal_type: MemorySignalEventRecord["signalType"];
          memory_kind: MemorySignalEventRecord["memoryKind"];
          content_ref: string | null;
          semantic_key: string;
          value: number;
          source_ref: string;
          metadata_json: string;
          created_at: string;
        };
        return {
          signalId: record.signal_id,
          agentId: record.agent_id,
          scope: record.scope,
          sessionKey: record.session_key ?? undefined,
          signalType: record.signal_type,
          memoryKind: record.memory_kind,
          contentRef: record.content_ref ?? undefined,
          semanticKey: record.semantic_key,
          value: record.value,
          sourceRef: record.source_ref,
          metadataJson: safeJsonParse<Record<string, unknown>>(record.metadata_json, {}),
          createdAt: record.created_at,
        } satisfies MemorySignalEventRecord;
      });
  }

  listSignalsForTargets(params: {
    agentId: string;
    targets: Array<{
      memoryKind: MemorySignalEventRecord["memoryKind"];
      contentRef?: string;
      semanticKey: string;
    }>;
    until?: string;
  }): MemorySignalEventRecord[] {
    if (params.targets.length === 0) {
      return [];
    }
    const values: Array<string | number> = [params.agentId];
    const targetClauses = params.targets.map((target) => {
      values.push(target.memoryKind, target.contentRef ?? null, target.semanticKey);
      return `(
        memory_kind = ?
        AND (
          (content_ref IS NOT NULL AND content_ref = ?)
          OR (content_ref IS NULL AND semantic_key = ?)
        )
      )`;
    });
    let sql = `
      SELECT signal_id, agent_id, scope, session_key, signal_type, memory_kind, content_ref, semantic_key, value,
             source_ref, metadata_json, created_at
        FROM memory_signal_events
       WHERE agent_id = ?
         AND (${targetClauses.join(" OR ")})
    `;
    if (params.until) {
      sql += " AND created_at <= ?";
      values.push(params.until);
    }
    sql += " ORDER BY created_at ASC, rowid ASC";
    return this.db
      .prepare(sql)
      .all(...values)
      .map((row) => {
        const record = row as {
          signal_id: string;
          agent_id: string;
          scope: string;
          session_key: string | null;
          signal_type: MemorySignalEventRecord["signalType"];
          memory_kind: MemorySignalEventRecord["memoryKind"];
          content_ref: string | null;
          semantic_key: string;
          value: number;
          source_ref: string;
          metadata_json: string;
          created_at: string;
        };
        return {
          signalId: record.signal_id,
          agentId: record.agent_id,
          scope: record.scope,
          sessionKey: record.session_key ?? undefined,
          signalType: record.signal_type,
          memoryKind: record.memory_kind,
          contentRef: record.content_ref ?? undefined,
          semanticKey: record.semantic_key,
          value: record.value,
          sourceRef: record.source_ref,
          metadataJson: safeJsonParse<Record<string, unknown>>(record.metadata_json, {}),
          createdAt: record.created_at,
        } satisfies MemorySignalEventRecord;
      });
  }

  latestSignalCreatedAt(params: {
    agentId: string;
    sessionKey?: string;
  }): string | undefined {
    const values: Array<string> = [params.agentId];
    let sql = `
      SELECT MAX(created_at) AS createdAt
        FROM memory_signal_events
       WHERE agent_id = ?
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    const row = this.db.prepare(sql).get(...values) as { createdAt: string | null } | undefined;
    return row?.createdAt ?? undefined;
  }

  startMaintenance(params: {
    agentId: string;
    jobType: string;
    stats: Record<string, unknown>;
    startedAt: string;
  }): string {
    const runId = randomId("maintenance");
    this.db
      .prepare(
        `INSERT INTO maintenance_runs(
          run_id, agent_id, job_type, stats_json, started_at, completed_at, status
        ) VALUES (?, ?, ?, ?, ?, NULL, 'running')`,
      )
      .run(runId, params.agentId, params.jobType, JSON.stringify(params.stats), params.startedAt);
    return runId;
  }

  finishMaintenance(run: MaintenanceRunRecord): void {
    this.db
      .prepare(
        `UPDATE maintenance_runs
            SET stats_json = ?, completed_at = ?, status = ?
          WHERE run_id = ?`,
      )
      .run(JSON.stringify(run.statsJson), run.completedAt ?? null, run.status, run.runId);
  }
}
