const SEARCH_STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "do",
    "does",
    "i",
    "is",
    "of",
    "on",
    "the",
    "to",
    "was",
    "what",
]);
function tokenizeSearch(query) {
    return query
        .toLowerCase()
        .split(/[^a-z0-9_.:-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 1 && !SEARCH_STOPWORDS.has(term));
}
function toFtsQuery(query) {
    const terms = tokenizeSearch(query);
    if (terms.length === 0) {
        return query;
    }
    return terms.map((term) => `"${term}"`).join(" OR ");
}
function fallbackKeywordSearch(repo, params) {
    const terms = tokenizeSearch(params.query);
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
        const lower = doc.text.toLowerCase();
        const score = terms.reduce((acc, term) => acc + (lower.includes(term) ? 0.18 : 0), 0);
        return {
            docId: doc.docId,
            text: doc.text,
            metadata: doc.metadataJson,
            score,
            backend: "fts",
        };
    })
        .filter((hit) => hit.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, params.limit);
}
export class SqliteFtsBackend {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    upsertDocs(docs) {
        this.repo.upsertDocs(docs);
    }
    deleteDocs(docIds) {
        this.repo.deleteDocs(docIds);
    }
    keywordSearch(params) {
        try {
            const hits = this.repo.keywordSearch({
                ...params,
                query: toFtsQuery(params.query),
            });
            if (hits.length > 0) {
                return hits;
            }
            return fallbackKeywordSearch(this.repo, params);
        }
        catch {
            return fallbackKeywordSearch(this.repo, params);
        }
    }
    async similaritySearch() {
        return [];
    }
    async hybridSearch(params) {
        return this.keywordSearch(params);
    }
    async embedTextsBatch() {
        return [];
    }
}
