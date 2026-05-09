import { safeJsonParse } from "../../support.js";
export class SourceSegmentRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    insertMany(segments) {
        if (segments.length === 0) {
            return;
        }
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO source_segments(
        segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope, session_key,
        turn_id, seq, role, tool_name, segment_index, char_start, char_end, text, content_hash,
        created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const segment of segments) {
            stmt.run(segment.segmentId, segment.sourceGroupId, segment.parentSourceRef, segment.chunkId, segment.agentId, segment.scope, segment.sessionKey, segment.turnId, segment.seq, segment.role, segment.toolName ?? null, segment.segmentIndex, segment.charStart, segment.charEnd, segment.text, segment.contentHash, segment.createdAt, segment.updatedAt, JSON.stringify(segment.metadataJson));
        }
    }
    listByChunk(chunkId) {
        const rows = this.db
            .prepare(`SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE chunk_id = ?
          ORDER BY segment_index ASC`)
            .all(chunkId);
        return rows.map((row) => this.toRecord(row));
    }
    listBySourceGroup(params) {
        if (params.scopes.length === 0) {
            return [];
        }
        const placeholders = params.scopes.map(() => "?").join(", ");
        const rows = this.db
            .prepare(`SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE agent_id = ?
            AND scope IN (${placeholders})
            AND source_group_id = ?
          ORDER BY segment_index ASC`)
            .all(params.agentId, ...params.scopes, params.sourceGroupId);
        return rows.map((row) => this.toRecord(row));
    }
    listByParentSourceRefs(params) {
        if (params.scopes.length === 0 || params.parentSourceRefs.length === 0) {
            return [];
        }
        const scopePlaceholders = params.scopes.map(() => "?").join(", ");
        const sourcePlaceholders = params.parentSourceRefs.map(() => "?").join(", ");
        const rows = this.db
            .prepare(`SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE agent_id = ?
            AND scope IN (${scopePlaceholders})
            AND parent_source_ref IN (${sourcePlaceholders})
          ORDER BY created_at DESC, segment_index ASC
          LIMIT ${Math.max(1, Math.trunc(params.limit ?? 64))}`)
            .all(params.agentId, ...params.scopes, ...params.parentSourceRefs);
        return rows.map((row) => this.toRecord(row));
    }
    toRecord(row) {
        return {
            segmentId: row.segment_id,
            sourceGroupId: row.source_group_id,
            parentSourceRef: row.parent_source_ref,
            chunkId: row.chunk_id,
            agentId: row.agent_id,
            scope: row.scope,
            sessionKey: row.session_key,
            turnId: row.turn_id,
            seq: row.seq,
            role: row.role,
            toolName: row.tool_name ?? undefined,
            segmentIndex: row.segment_index,
            charStart: row.char_start,
            charEnd: row.char_end,
            text: row.text,
            contentHash: row.content_hash,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            metadataJson: safeJsonParse(row.metadata_json, {}),
        };
    }
}
