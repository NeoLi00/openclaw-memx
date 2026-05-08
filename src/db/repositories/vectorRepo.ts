import { safeJsonParse } from "../../support.js";
import type { SearchHit, VectorDocRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type VectorDocRow = {
  doc_id: string;
  doc_kind: VectorDocRecord["docKind"];
  source_id: string;
  scope: string;
  agent_id: string;
  text: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  materialized_epoch: number;
};

export class VectorRepo {
  constructor(private readonly db: MemxDbClient) {}

  private appendDocFilters(
    clauses: string[],
    values: Array<string | number>,
    params: {
      docKinds?: VectorDocRecord["docKind"][];
      docTypes?: string[];
    },
    tablePrefix = "vector_docs",
  ): void {
    if (params.docKinds && params.docKinds.length > 0) {
      const placeholders = params.docKinds.map(() => "?").join(", ");
      clauses.push(`${tablePrefix}.doc_kind IN (${placeholders})`);
      values.push(...params.docKinds);
    }
    if (params.docTypes && params.docTypes.length > 0) {
      const placeholders = params.docTypes.map(() => "?").join(", ");
      clauses.push(
        `COALESCE(json_extract(${tablePrefix}.metadata_json, '$.memxDocType'), ${tablePrefix}.doc_kind) IN (${placeholders})`,
      );
      values.push(...params.docTypes);
    }
  }

  upsertDocs(docs: VectorDocRecord[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO vector_docs(
        doc_id, doc_kind, source_id, scope, agent_id, text, metadata_json, created_at, updated_at, materialized_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_id) DO UPDATE SET
        doc_kind = excluded.doc_kind,
        source_id = excluded.source_id,
        scope = excluded.scope,
        agent_id = excluded.agent_id,
        text = excluded.text,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        materialized_epoch = excluded.materialized_epoch`,
    );
    const ftsDelete = this.db.prepare("DELETE FROM vector_docs_fts WHERE doc_id = ?");
    const ftsInsert = this.db.prepare(
      `INSERT INTO vector_docs_fts(doc_id, doc_kind, source_id, scope, agent_id, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const doc of docs) {
      stmt.run(
        doc.docId,
        doc.docKind,
        doc.sourceId,
        doc.scope,
        doc.agentId,
        doc.text,
        JSON.stringify(doc.metadataJson),
        doc.createdAt,
        doc.updatedAt,
        doc.materializedEpoch ?? 0,
      );
      // Manual FTS sync ensures correctness regardless of trigger availability
      // (triggers provide a safety net for direct SQL operations).
      ftsDelete.run(doc.docId);
      ftsInsert.run(doc.docId, doc.docKind, doc.sourceId, doc.scope, doc.agentId, doc.text);
    }
  }

  deleteDocs(docIds: string[]): void {
    if (docIds.length === 0) {
      return;
    }
    const deleteVector = this.db.prepare("DELETE FROM vector_docs WHERE doc_id = ?");
    const deleteFts = this.db.prepare("DELETE FROM vector_docs_fts WHERE doc_id = ?");
    const deleteEmbeddings = this.db.prepare("DELETE FROM vector_embeddings WHERE doc_id = ?");
    for (const docId of docIds) {
      deleteVector.run(docId);
      deleteFts.run(docId);
      deleteEmbeddings.run(docId);
    }
  }

  keywordSearch(params: {
    agentId: string;
    scopes: string[];
    query: string;
    limit: number;
    readEpoch?: number;
    docKinds?: VectorDocRecord["docKind"][];
    docTypes?: string[];
  }): SearchHit[] {
    if (!params.query.trim() || params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const whereClauses = [
      "vector_docs.agent_id = ?",
      `vector_docs.scope IN (${placeholders})`,
      ...(typeof params.readEpoch === "number" ? ["vector_docs.materialized_epoch <= ?"] : []),
    ];
    const values: Array<string | number> = [
      params.agentId,
      ...params.scopes,
      ...(typeof params.readEpoch === "number" ? [params.readEpoch] : []),
    ];
    this.appendDocFilters(whereClauses, values, params);
    const rows = this.db
      .prepare(
        `SELECT doc_id, text, metadata_json, rank
           FROM (
             SELECT vector_docs.doc_id AS doc_id,
                    vector_docs.text AS text,
                    vector_docs.metadata_json AS metadata_json,
                    bm25(vector_docs_fts) AS rank
               FROM vector_docs_fts
               JOIN vector_docs USING (doc_id)
              WHERE ${whereClauses.join("\n                AND ")}
                AND vector_docs_fts MATCH ?
           )
          ORDER BY rank ASC
          LIMIT ${Math.max(1, params.limit)}`,
      )
      .all(...values, params.query) as Array<{
      doc_id: string;
      text: string;
      metadata_json: string;
      rank: number;
    }>;
    return rows.map((row) => ({
      docId: row.doc_id,
      text: row.text,
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
      score: 1 / (1 + Math.abs(row.rank ?? 0)),
      backend: "fts",
    }));
  }

  listDocs(params: {
    agentId: string;
    scopes: string[];
    limit?: number;
    readEpoch?: number;
    docKinds?: VectorDocRecord["docKind"][];
    docTypes?: string[];
  }): VectorDocRecord[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const whereClauses = [
      "agent_id = ?",
      `scope IN (${placeholders})`,
      ...(typeof params.readEpoch === "number" ? ["materialized_epoch <= ?"] : []),
    ];
    const values: Array<string | number> = [
      params.agentId,
      ...params.scopes,
      ...(typeof params.readEpoch === "number" ? [params.readEpoch] : []),
    ];
    this.appendDocFilters(whereClauses, values, params, "vector_docs");
    let sql = `
      SELECT doc_id, doc_kind, source_id, scope, agent_id, text, metadata_json, created_at, updated_at
             , materialized_epoch
        FROM vector_docs
       WHERE ${whereClauses.join("\n         AND ")}
       ORDER BY updated_at DESC
    `;
    if (params.limit) {
      sql += ` LIMIT ${Math.max(1, Math.trunc(params.limit))}`;
    }
    const rows = this.db.prepare(sql).all(...values) as VectorDocRow[];
    return rows.map((row) => ({
      docId: row.doc_id,
      docKind: row.doc_kind,
      sourceId: row.source_id,
      scope: row.scope,
      agentId: row.agent_id,
      text: row.text,
      metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      materializedEpoch: row.materialized_epoch,
    }));
  }

  upsertEmbedding(params: {
    docId: string;
    agentId: string;
    scope: string;
    embedding: number[];
    updatedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO vector_embeddings(doc_id, agent_id, scope, dimensions, embedding_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(doc_id) DO UPDATE SET
           agent_id = excluded.agent_id,
           scope = excluded.scope,
           dimensions = excluded.dimensions,
           embedding_json = excluded.embedding_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        params.docId,
        params.agentId,
        params.scope,
        params.embedding.length,
        JSON.stringify(params.embedding),
        params.updatedAt,
      );
  }

  listEmbeddings(params: {
    agentId: string;
    scopes: string[];
    limit: number;
    readEpoch?: number;
    docKinds?: VectorDocRecord["docKind"][];
    docTypes?: string[];
  }): Array<{
    docId: string;
    scope: string;
    embedding: number[];
    updatedAt: string;
  }> {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const whereClauses = [
      "vector_embeddings.agent_id = ?",
      `vector_embeddings.scope IN (${placeholders})`,
      ...(typeof params.readEpoch === "number" ? ["vector_docs.materialized_epoch <= ?"] : []),
    ];
    const values: Array<string | number> = [
      params.agentId,
      ...params.scopes,
      ...(typeof params.readEpoch === "number" ? [params.readEpoch] : []),
    ];
    this.appendDocFilters(whereClauses, values, params);
    const rows = this.db
      .prepare(
        `SELECT vector_embeddings.doc_id, vector_embeddings.scope, vector_embeddings.embedding_json, vector_embeddings.updated_at
           FROM vector_embeddings
           JOIN vector_docs ON vector_docs.doc_id = vector_embeddings.doc_id
          WHERE ${whereClauses.join("\n            AND ")}
          ORDER BY vector_embeddings.updated_at DESC
          LIMIT ${Math.max(1, params.limit)}`,
      )
      .all(...values) as Array<{
      doc_id: string;
      scope: string;
      embedding_json: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      docId: row.doc_id,
      scope: row.scope,
      embedding: safeJsonParse<number[]>(row.embedding_json, []),
      updatedAt: row.updated_at,
    }));
  }

  getDoc(docId: string, readEpoch?: number): VectorDocRecord | null {
    const row = this.db
      .prepare(
        `SELECT doc_id, doc_kind, source_id, scope, agent_id, text, metadata_json, created_at, updated_at, materialized_epoch
           FROM vector_docs
          WHERE doc_id = ?
            ${typeof readEpoch === "number" ? "AND materialized_epoch <= ?" : ""}`,
      )
      .get(docId, ...(typeof readEpoch === "number" ? [readEpoch] : [])) as
      | VectorDocRow
      | undefined;
    return row
      ? {
          docId: row.doc_id,
          docKind: row.doc_kind,
          sourceId: row.source_id,
          scope: row.scope,
          agentId: row.agent_id,
          text: row.text,
          metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          materializedEpoch: row.materialized_epoch,
        }
      : null;
  }
}
