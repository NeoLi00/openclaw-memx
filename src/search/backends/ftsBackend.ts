import type { VectorRepo } from "../../db/repositories/vectorRepo.js";
import {
  buildFtsMatchQuery,
  buildLexicalSearchText,
  hasCjkLexicalTerms,
  lexicalSearchTerms,
} from "../lexical.js";
import type {
  RetrievalBackend,
  RetrievalSearchParams,
  SearchHit,
  VectorDocRecord,
} from "../../types.js";

function fallbackKeywordSearch(repo: VectorRepo, params: RetrievalSearchParams): SearchHit[] {
  const terms = lexicalSearchTerms(params.query);
  if (terms.length === 0) {
    return [];
  }
  const docs = repo.listDocs({
    agentId: params.agentId,
    scopes: params.scopes,
    limit: Math.max(params.limit * 8, 64),
    readEpoch: params.readEpoch,
    docKinds: params.docKinds,
    docTypes: params.docTypes,
  });
  return docs
    .map((doc) => {
      const searchText = buildLexicalSearchText(doc.text);
      const score = terms.reduce((acc, term) => acc + (searchText.includes(term) ? 0.18 : 0), 0);
      return {
        docId: doc.docId,
        text: doc.text,
        metadata: doc.metadataJson,
        score,
        backend: "fts" as const,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, params.limit);
}

function mergeFtsHits(primary: SearchHit[], fallback: SearchHit[], limit: number): SearchHit[] {
  if (fallback.length === 0) {
    return primary.slice(0, limit);
  }
  const merged = new Map<string, SearchHit>();
  for (const hit of [...primary, ...fallback]) {
    const existing = merged.get(hit.docId);
    if (!existing || hit.score > existing.score) {
      merged.set(hit.docId, hit);
    }
  }
  return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

export class SqliteFtsBackend implements RetrievalBackend {
  constructor(private readonly repo: VectorRepo) {}

  upsertDocs(docs: VectorDocRecord[]): void {
    this.repo.upsertDocs(docs);
  }

  deleteDocs(docIds: string[]): void {
    this.repo.deleteDocs(docIds);
  }

  keywordSearch(params: RetrievalSearchParams): SearchHit[] {
    try {
      const hits = this.repo.keywordSearch({
        ...params,
        query: buildFtsMatchQuery(params.query),
      });
      if (hits.length > 0 && !hasCjkLexicalTerms(params.query)) {
        return hits;
      }
      return mergeFtsHits(hits, fallbackKeywordSearch(this.repo, params), params.limit);
    } catch {
      return fallbackKeywordSearch(this.repo, params);
    }
  }

  async similaritySearch(): Promise<SearchHit[]> {
    return [];
  }

  async hybridSearch(params: RetrievalSearchParams): Promise<SearchHit[]> {
    return this.keywordSearch(params);
  }

  async embedTextsBatch(): Promise<number[][]> {
    return [];
  }
}
