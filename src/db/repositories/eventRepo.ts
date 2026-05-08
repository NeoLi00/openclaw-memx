import { tokenizeSearchTerms } from "../../pipeline/semantics.js";
import { safeJsonParse } from "../../support.js";
import type { NormalizedEvent } from "../../types.js";
import type { MemxDbClient } from "../client.js";

type EventRow = {
  event_id: string;
  agent_id: string;
  scope: string;
  event_type: string;
  text: string;
  normalized_text: string;
  observed_at: string;
  valid_from: string | null;
  valid_to: string | null;
  source_kind: "user" | "assistant" | "tool";
  source_ref: string;
  session_key: string | null;
  tool_name: string | null;
  confidence: number;
  metadata_json: string;
  materialized_epoch: number;
};

const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "did",
  "do",
  "happened",
  "history",
  "i",
  "last",
  "the",
  "timeline",
  "to",
  "what",
  "when",
  "之前",
  "以后",
  "后来",
  "问题",
  "发生",
  "什么",
]);

function tokenizeSearch(text: string): string[] {
  return tokenizeSearchTerms(text, SEARCH_STOPWORDS);
}

function structuredEventSummary(metadataJson: Record<string, unknown>): string {
  const value = metadataJson.memxStructuredSummary;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export class EventRepo {
  constructor(private readonly db: MemxDbClient) {}

  get(eventId: string): NormalizedEvent | null {
    const row = this.db
      .prepare(
        `SELECT event_id, agent_id, scope, event_type, text, normalized_text, observed_at, valid_from,
                valid_to, source_kind, source_ref, session_key, tool_name, confidence, metadata_json, materialized_epoch
           FROM episodic_events
          WHERE event_id = ?
          LIMIT 1`,
      )
      .get(eventId) as EventRow | undefined;
    return row ? this.toEvent(row) : null;
  }

  findNearDuplicate(params: {
    agentId: string;
    scope: string;
    normalizedText: string;
    observedAfter: string;
  }): NormalizedEvent | null {
    const row = this.db
      .prepare(
        `SELECT event_id, agent_id, scope, event_type, text, normalized_text, observed_at, valid_from,
                valid_to, source_kind, source_ref, session_key, tool_name, confidence, metadata_json, materialized_epoch
           FROM episodic_events
          WHERE agent_id = ?
            AND scope = ?
            AND normalized_text = ?
            AND observed_at >= ?
          ORDER BY observed_at DESC
          LIMIT 1`,
      )
      .get(params.agentId, params.scope, params.normalizedText, params.observedAfter) as
      | EventRow
      | undefined;
    return row ? this.toEvent(row) : null;
  }

  append(event: NormalizedEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO episodic_events(
          event_id, agent_id, scope, event_type, text, normalized_text, observed_at, valid_from,
          valid_to, source_kind, source_ref, session_key, tool_name, confidence, metadata_json, materialized_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.agentId,
        event.scope,
        event.eventType,
        event.text,
        event.normalizedText,
        event.observedAt,
        event.validFrom ?? null,
        event.validTo ?? null,
        event.sourceKind,
        event.sourceRef,
        event.sessionKey ?? null,
        event.toolName ?? null,
        event.confidence,
        JSON.stringify(event.metadataJson),
        event.materializedEpoch ?? 0,
      );
  }

  search(params: {
    agentId: string;
    scopes: string[];
    sessionKey?: string;
    text?: string;
    eventType?: string;
    limit?: number;
    since?: string;
    after?: string;
    until?: string;
    readEpoch?: number;
  }): NormalizedEvent[] {
    if (params.scopes.length === 0) {
      return [];
    }
    const placeholders = params.scopes.map(() => "?").join(", ");
    const values: Array<string | number> = [params.agentId, ...params.scopes];
    let sql = `
      SELECT event_id, agent_id, scope, event_type, text, normalized_text, observed_at, valid_from,
             valid_to, source_kind, source_ref, session_key, tool_name, confidence, metadata_json, materialized_epoch
        FROM episodic_events
       WHERE agent_id = ?
         AND scope IN (${placeholders})
    `;
    if (params.eventType) {
      sql += " AND event_type = ?";
      values.push(params.eventType);
    }
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    if (params.since) {
      sql += " AND observed_at >= ?";
      values.push(params.since);
    }
    if (params.after) {
      sql += " AND observed_at > ?";
      values.push(params.after);
    }
    if (params.until) {
      sql += " AND observed_at <= ?";
      values.push(params.until);
    }
    if (typeof params.readEpoch === "number") {
      sql += " AND materialized_epoch <= ?";
      values.push(params.readEpoch);
    }
    sql += " ORDER BY observed_at DESC";
    sql += ` LIMIT ${Math.max(24, Math.trunc((params.limit ?? 8) * 6))}`;
    const rows = this.db.prepare(sql).all(...values) as EventRow[];
    const events = rows.map((row) => this.toEvent(row));
    if (!params.text) {
      return events.slice(0, params.limit ?? events.length);
    }
    const terms = tokenizeSearch(params.text);
    if (terms.length === 0) {
      return events.slice(0, params.limit ?? events.length);
    }
    return events
      .map((event) => {
        const haystack =
          `${event.text} ${event.normalizedText} ${event.eventType} ${structuredEventSummary(event.metadataJson)}`.toLowerCase();
        const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
        return { event, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.event.observedAt.localeCompare(left.event.observedAt);
      })
      .slice(0, params.limit ?? events.length)
      .map((entry) => entry.event);
  }

  delete(params: { agentId: string; eventId?: string; scope?: string }): number {
    const clauses = ["agent_id = ?"];
    const values: Array<string | number> = [params.agentId];
    if (params.eventId) {
      clauses.push("event_id = ?");
      values.push(params.eventId);
    }
    if (params.scope) {
      clauses.push("scope = ?");
      values.push(params.scope);
    }
    const result = this.db
      .prepare(`DELETE FROM episodic_events WHERE ${clauses.join(" AND ")}`)
      .run(...values);
    return Number(result.changes ?? 0);
  }

  latestObservedAt(params: {
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
      SELECT MAX(observed_at) AS observedAt
        FROM episodic_events
       WHERE agent_id = ?
         AND scope IN (${placeholders})
    `;
    if (params.sessionKey) {
      sql += " AND session_key = ?";
      values.push(params.sessionKey);
    }
    const row = this.db.prepare(sql).get(...values) as { observedAt: string | null } | undefined;
    return row?.observedAt ?? undefined;
  }

  private toEvent(row: EventRow): NormalizedEvent {
    return {
      eventId: row.event_id,
      agentId: row.agent_id,
      scope: row.scope,
      eventType: row.event_type,
      text: row.text,
      normalizedText: row.normalized_text,
      observedAt: row.observed_at,
      validFrom: row.valid_from ?? undefined,
      validTo: row.valid_to ?? undefined,
      sourceKind: row.source_kind,
      sourceRef: row.source_ref,
      sessionKey: row.session_key ?? undefined,
      toolName: row.tool_name ?? undefined,
      confidence: row.confidence,
      metadataJson: safeJsonParse<Record<string, unknown>>(row.metadata_json, {}),
      materializedEpoch: row.materialized_epoch,
    };
  }
}
