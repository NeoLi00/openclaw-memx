import { safeJsonParse } from "../../support.js";
import type { ConversationTask } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type TaskRow = {
  task_id: string;
  agent_id: string;
  scope: string;
  session_key: string;
  title: string;
  summary: string;
  status: "active" | "completed" | "skipped";
  started_at: string;
  ended_at: string | null;
  updated_at: string;
  metadata_json: string;
};

export class TaskRepo {
  constructor(private readonly db: MemxDbClient) {}

  create(task: ConversationTask): void {
    this.db
      .prepare(
        `INSERT INTO conversation_tasks(
          task_id, agent_id, scope, session_key, title, summary, status, started_at, ended_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          scope = excluded.scope,
          session_key = excluded.session_key,
          title = excluded.title,
          summary = excluded.summary,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          updated_at = excluded.updated_at,
          metadata_json = excluded.metadata_json`,
      )
      .run(
        task.taskId,
        task.agentId,
        task.scope,
        task.sessionKey,
        task.title,
        task.summary,
        task.status,
        task.startedAt,
        task.endedAt ?? null,
        task.updatedAt,
        JSON.stringify(task.metadataJson),
      );
  }

  update(taskId: string, patch: Partial<ConversationTask>): void {
    const current = this.get(taskId);
    if (!current) {
      return;
    }
    const next: ConversationTask = {
      ...current,
      ...patch,
      metadataJson: patch.metadataJson ?? current.metadataJson,
    };
    this.create(next);
  }

  get(taskId: string): ConversationTask | null {
    const row = this.db
      .prepare(
        `SELECT task_id, agent_id, scope, session_key, title, summary, status, started_at, ended_at, updated_at, metadata_json
           FROM conversation_tasks
          WHERE task_id = ?`,
      )
      .get(taskId) as TaskRow | undefined;
    return row ? this.toTask(row) : null;
  }

  getActive(params: {
    agentId: string;
    scope: string;
    sessionKey: string;
  }): ConversationTask | null {
    const row = this.db
      .prepare(
        `SELECT task_id, agent_id, scope, session_key, title, summary, status, started_at, ended_at, updated_at, metadata_json
           FROM conversation_tasks
          WHERE agent_id = ?
            AND scope = ?
            AND session_key = ?
            AND status = 'active'
          ORDER BY updated_at DESC
          LIMIT 1`,
      )
      .get(params.agentId, params.scope, params.sessionKey) as TaskRow | undefined;
    return row ? this.toTask(row) : null;
  }

  listActive(params: {
    agentId: string;
    scopes: string[];
    sessionKey?: string;
    limit?: number;
  }): ConversationTask[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const values: Array<string | number> = [params.agentId, ...params.scopes];
    let sql = `
      SELECT task_id, agent_id, scope, session_key, title, summary, status, started_at, ended_at, updated_at, metadata_json
        FROM conversation_tasks
       WHERE agent_id = ?
         AND scope IN (${placeholders})
         AND status = 'active'
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ${Math.max(1, params.limit ?? 4)}`;
    const rows = this.db.prepare(sql).all(...values) as TaskRow[];
    return rows.map((row) => this.toTask(row));
  }

  listRecent(params: {
    agentId: string;
    scopes: string[];
    limit?: number;
    includeSkipped?: boolean;
    sessionKey?: string;
  }): ConversationTask[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const values: Array<string | number> = [params.agentId, ...params.scopes];
    let sql = `
      SELECT task_id, agent_id, scope, session_key, title, summary, status, started_at, ended_at, updated_at, metadata_json
        FROM conversation_tasks
       WHERE agent_id = ?
         AND scope IN (${placeholders})
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    if (!params.includeSkipped) {
      sql += " AND status != 'skipped'";
    }
    sql += ` ORDER BY updated_at DESC LIMIT ${Math.max(1, params.limit ?? 8)}`;
    const rows = this.db.prepare(sql).all(...values) as TaskRow[];
    return rows.map((row) => this.toTask(row));
  }

  latestUpdatedAt(params: {
    agentId: string;
    scopes: string[];
    sessionKey?: string;
  }): string | undefined {
    if (params.scopes.length === 0) {
      return undefined;
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const values: Array<string> = [params.agentId, ...params.scopes];
    let sql = `
      SELECT MAX(updated_at) AS updatedAt
        FROM conversation_tasks
       WHERE agent_id = ?
         AND scope IN (${placeholders})
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    const row = this.db.prepare(sql).get(...values) as { updatedAt: string | null } | undefined;
    return row?.updatedAt ?? undefined;
  }

  private toTask(row: TaskRow): ConversationTask {
    return {
      taskId: row.task_id,
      agentId: row.agent_id,
      scope: row.scope,
      sessionKey: row.session_key,
      title: row.title,
      summary: row.summary,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      updatedAt: row.updated_at,
      metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    };
  }
}
