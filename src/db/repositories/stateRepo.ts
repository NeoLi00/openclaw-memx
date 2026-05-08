import { addHours, safeJsonParse } from "../../support.js";
import type { NormalizedState } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type StateRow = {
  key: string;
  value_json: string;
  scope: string;
  agent_id: string;
  state_kind: "session" | "durable";
  confidence: number;
  source_ref: string;
  updated_at: string;
  expires_at: string | null;
  materialized_epoch: number;
};

export class StateRepo {
  constructor(private readonly db: MemxDbClient) {}

  upsert(state: NormalizedState): void {
    this.db
      .prepare(
        `INSERT INTO state_kv(
          key, value_json, scope, agent_id, state_kind, confidence, source_ref, updated_at, expires_at, materialized_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent_id, scope, key) DO UPDATE SET
          value_json = excluded.value_json,
          state_kind = excluded.state_kind,
          confidence = excluded.confidence,
          source_ref = excluded.source_ref,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          materialized_epoch = excluded.materialized_epoch`,
      )
      .run(
        state.key,
        JSON.stringify(state.valueJson),
        state.scope,
        state.agentId,
        state.stateKind,
        state.confidence,
        state.sourceRef,
        state.updatedAt,
        state.expiresAt ?? null,
        state.materializedEpoch ?? 0,
      );
  }

  get(params: {
    agentId: string;
    scopes: string[];
    key?: string;
    includeExpired?: boolean;
    now?: string;
    readEpoch?: number;
  }): NormalizedState[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const values: Array<string | number> = [params.agentId, ...params.scopes];
    let sql = `
      SELECT key, value_json, scope, agent_id, state_kind, confidence, source_ref, updated_at, expires_at
             , materialized_epoch
      FROM state_kv
      WHERE agent_id = ?
        AND scope IN (${placeholders})
    `;
    if (params.key) {
      sql += " AND key = ?";
      values.push(params.key);
    }
    if (!params.includeExpired) {
      sql += " AND (expires_at IS NULL OR expires_at > ?)";
      values.push(params.now ?? new Date().toISOString());
    }
    if (typeof params.readEpoch === "number") {
      sql += " AND materialized_epoch <= ?";
      values.push(params.readEpoch);
    }
    sql += " ORDER BY updated_at DESC";
    const rows = this.db.prepare(sql).all(...values) as StateRow[];
    return rows.map((row) => ({
      key: row.key,
      valueJson: safeJsonParse<Record<string, unknown>>(row.value_json, {}),
      scope: row.scope,
      agentId: row.agent_id,
      stateKind: row.state_kind,
      confidence: row.confidence,
      sourceRef: row.source_ref,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
      materializedEpoch: row.materialized_epoch,
    }));
  }

  delete(params: { agentId: string; scope?: string; key?: string }): number {
    const clauses = ["agent_id = ?"];
    const values: Array<string | number> = [params.agentId];
    if (params.scope) {
      clauses.push("scope = ?");
      values.push(params.scope);
    }
    if (params.key) {
      clauses.push("key = ?");
      values.push(params.key);
    }
    const stmt = this.db.prepare(`DELETE FROM state_kv WHERE ${clauses.join(" AND ")}`);
    const result = stmt.run(...values);
    return Number(result.changes ?? 0);
  }

  expireSessionStates(agentId: string, now: string): number {
    const result = this.db
      .prepare(
        "DELETE FROM state_kv WHERE agent_id = ? AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .run(agentId, now);
    return Number(result.changes ?? 0);
  }

  createExpiry(updatedAt: string, ttlHours: number): string {
    return addHours(updatedAt, ttlHours);
  }
}
