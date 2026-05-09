export class ChunkRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    insert(chunk) {
        this.db
            .prepare(`INSERT OR REPLACE INTO conversation_chunks(
          chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
          content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
          merge_count, last_hit_at, source_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(chunk.chunkId, chunk.agentId, chunk.scope, chunk.sessionKey, chunk.turnId, chunk.seq, chunk.role, chunk.toolName ?? null, chunk.chunkKind, chunk.content, chunk.summary, chunk.contentHash, chunk.taskId ?? null, chunk.dedupStatus, chunk.dedupTarget ?? null, chunk.dedupReason ?? null, chunk.mergeCount, chunk.lastHitAt ?? null, chunk.sourceRef, chunk.createdAt, chunk.updatedAt);
    }
    get(chunkId) {
        const row = this.db
            .prepare(`SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
                content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
                merge_count, last_hit_at, source_ref, created_at, updated_at
           FROM conversation_chunks
          WHERE chunk_id = ?`)
            .get(chunkId);
        return row ? this.toChunk(row) : null;
    }
    findActiveByHash(params) {
        const row = this.db
            .prepare(`SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
                content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
                merge_count, last_hit_at, source_ref, created_at, updated_at
           FROM conversation_chunks
          WHERE agent_id = ?
            AND scope = ?
            AND role = ?
            AND content_hash = ?
            AND dedup_status = 'active'
          ORDER BY updated_at DESC
          LIMIT 1`)
            .get(params.agentId, params.scope, params.role, params.contentHash);
        return row ? this.toChunk(row) : null;
    }
    listRecentActive(params) {
        if (params.scopes.length === 0) {
            return [];
        }
        const placeholders = params.scopes.map(() => "?").join(", ");
        const values = [params.agentId, ...params.scopes];
        let sql = `
      SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
             content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
             merge_count, last_hit_at, source_ref, created_at, updated_at
        FROM conversation_chunks
       WHERE agent_id = ?
         AND scope IN (${placeholders})
         AND dedup_status = 'active'
    `;
        if (params.sessionKey) {
            sql += " AND session_key = ?";
            values.push(params.sessionKey);
        }
        sql += ` ORDER BY created_at DESC LIMIT ${Math.max(1, params.limit ?? 16)}`;
        const rows = this.db.prepare(sql).all(...values);
        return rows.map((row) => this.toChunk(row));
    }
    listByTask(taskId) {
        const rows = this.db
            .prepare(`SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
                content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
                merge_count, last_hit_at, source_ref, created_at, updated_at
           FROM conversation_chunks
          WHERE task_id = ?
          ORDER BY created_at ASC, seq ASC`)
            .all(taskId);
        return rows.map((row) => this.toChunk(row));
    }
    listBySourceRefs(params) {
        if (params.scopes.length === 0 || params.sourceRefs.length === 0) {
            return [];
        }
        const scopePlaceholders = params.scopes.map(() => "?").join(", ");
        const sourceRefPlaceholders = params.sourceRefs.map(() => "?").join(", ");
        const rows = this.db
            .prepare(`SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
                content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
                merge_count, last_hit_at, source_ref, created_at, updated_at
           FROM conversation_chunks
          WHERE agent_id = ?
            AND scope IN (${scopePlaceholders})
            AND source_ref IN (${sourceRefPlaceholders})
            AND dedup_status = 'active'
          ORDER BY created_at DESC, seq DESC
          LIMIT ${Math.max(1, params.limit ?? 12)}`)
            .all(params.agentId, ...params.scopes, ...params.sourceRefs);
        return rows.map((row) => this.toChunk(row));
    }
    listUnassigned(params) {
        const rows = this.db
            .prepare(`SELECT chunk_id, agent_id, scope, session_key, turn_id, seq, role, tool_name, chunk_kind,
                content, summary, content_hash, task_id, dedup_status, dedup_target, dedup_reason,
                merge_count, last_hit_at, source_ref, created_at, updated_at
           FROM conversation_chunks
          WHERE agent_id = ?
            AND scope = ?
            AND session_key = ?
            AND task_id IS NULL
            AND dedup_status = 'active'
          ORDER BY created_at ASC, seq ASC`)
            .all(params.agentId, params.scope, params.sessionKey);
        return rows.map((row) => this.toChunk(row));
    }
    setTaskId(chunkId, taskId) {
        this.db
            .prepare("UPDATE conversation_chunks SET task_id = ?, updated_at = ? WHERE chunk_id = ?")
            .run(taskId, new Date().toISOString(), chunkId);
    }
    markStatus(params) {
        this.db
            .prepare(`UPDATE conversation_chunks
            SET dedup_status = ?,
                dedup_target = ?,
                dedup_reason = ?,
                merge_count = ?,
                updated_at = ?
          WHERE chunk_id = ?`)
            .run(params.status, params.target ?? null, params.reason ?? null, params.mergeCount ?? 0, params.updatedAt, params.chunkId);
    }
    toChunk(row) {
        return {
            chunkId: row.chunk_id,
            agentId: row.agent_id,
            scope: row.scope,
            sessionKey: row.session_key,
            turnId: row.turn_id,
            seq: row.seq,
            role: row.role,
            toolName: row.tool_name ?? undefined,
            chunkKind: row.chunk_kind,
            content: row.content,
            summary: row.summary,
            contentHash: row.content_hash,
            taskId: row.task_id ?? undefined,
            dedupStatus: row.dedup_status,
            dedupTarget: row.dedup_target ?? undefined,
            dedupReason: row.dedup_reason ?? undefined,
            mergeCount: row.merge_count,
            lastHitAt: row.last_hit_at ?? undefined,
            sourceRef: row.source_ref,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
