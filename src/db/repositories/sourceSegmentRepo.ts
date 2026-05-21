import { safeJsonParse } from "../../support.js";
import type { SourceSegmentRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type SourceSegmentRow = {
  segment_id: string;
  source_group_id: string;
  parent_source_ref: string;
  chunk_id: string;
  agent_id: string;
  scope: string;
  session_key: string;
  turn_id: string;
  seq: number;
  role: SourceSegmentRecord["role"];
  tool_name: string | null;
  segment_index: number;
  char_start: number;
  char_end: number;
  text: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
  metadata_json: string;
};

export class SourceSegmentRepo {
  constructor(private readonly db: MemxDbClient) {}

  insertMany(segments: SourceSegmentRecord[]): void {
    if (segments.length === 0) {
      return;
    }
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO source_segments(
        segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope, session_key,
        turn_id, seq, role, tool_name, segment_index, char_start, char_end, text, content_hash,
        created_at, updated_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const segment of segments) {
      stmt.run(
        segment.segmentId,
        segment.sourceGroupId,
        segment.parentSourceRef,
        segment.chunkId,
        segment.agentId,
        segment.scope,
        segment.sessionKey,
        segment.turnId,
        segment.seq,
        segment.role,
        segment.toolName ?? null,
        segment.segmentIndex,
        segment.charStart,
        segment.charEnd,
        segment.text,
        segment.contentHash,
        segment.createdAt,
        segment.updatedAt,
        JSON.stringify(segment.metadataJson),
      );
    }
  }

  listByChunk(chunkId: string): SourceSegmentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE chunk_id = ?
          ORDER BY segment_index ASC`,
      )
      .all(chunkId) as SourceSegmentRow[];
    return rows.map((row) => this.toRecord(row));
  }

  listBySourceGroup(params: {
    agentId: string;
    scopes: string[];
    sourceGroupId: string;
  }): SourceSegmentRecord[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE agent_id = ?
            AND scope IN (${placeholders})
            AND source_group_id = ?
          ORDER BY segment_index ASC`,
      )
      .all(params.agentId, ...params.scopes, params.sourceGroupId) as SourceSegmentRow[];
    return rows.map((row) => this.toRecord(row));
  }

  listByParentSourceRefs(params: {
    agentId: string;
    scopes: string[];
    parentSourceRefs: string[];
    limit?: number;
  }): SourceSegmentRecord[] {
    if (params.scopes.length === 0 || params.parentSourceRefs.length === 0) {
      return [];
    }
    const scopePlaceholders = params.scopes.map(() => "?").join(", ");
    const sourcePlaceholders = params.parentSourceRefs.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE agent_id = ?
            AND scope IN (${scopePlaceholders})
            AND parent_source_ref IN (${sourcePlaceholders})
          ORDER BY created_at DESC, segment_index ASC
          LIMIT ${Math.max(1, Math.trunc(params.limit ?? 64))}`,
      )
      .all(params.agentId, ...params.scopes, ...params.parentSourceRefs) as SourceSegmentRow[];
    return rows.map((row) => this.toRecord(row));
  }

  listByTurnIds(params: {
    agentId: string;
    scopes: string[];
    turnIds: string[];
    sessionKey?: string;
    limit?: number;
  }): SourceSegmentRecord[] {
    if (params.scopes.length === 0 || params.turnIds.length === 0) {
      return [];
    }
    const scopePlaceholders = params.scopes.map(() => "?").join(", ");
    const turnPlaceholders = params.turnIds.map(() => "?").join(", ");
    const values: Array<string | number> = [params.agentId, ...params.scopes, ...params.turnIds];
    let sessionClause = "";
    if (params.sessionKey) {
      sessionClause = " AND session_key = ?";
      values.push(params.sessionKey);
    }
    const rows = this.db
      .prepare(
        `SELECT segment_id, source_group_id, parent_source_ref, chunk_id, agent_id, scope,
                session_key, turn_id, seq, role, tool_name, segment_index, char_start, char_end,
                text, content_hash, created_at, updated_at, metadata_json
           FROM source_segments
          WHERE agent_id = ?
            AND scope IN (${scopePlaceholders})
            AND turn_id IN (${turnPlaceholders})
            ${sessionClause}
          ORDER BY created_at ASC, parent_source_ref ASC, segment_index ASC
          LIMIT ${Math.max(1, Math.trunc(params.limit ?? 256))}`,
      )
      .all(...values) as SourceSegmentRow[];
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: SourceSegmentRow): SourceSegmentRecord {
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
      metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
    };
  }
}
