import { buildFtsMatchQuery, buildLexicalSearchText, hasCjkLexicalTerms, lexicalSearchTerms } from "../lexical.mjs";
//#region src/search/backends/ftsBackend.ts
function fallbackKeywordSearch(repo, params) {
	const terms = lexicalSearchTerms(params.query);
	if (terms.length === 0) return [];
	return repo.listDocs({
		agentId: params.agentId,
		scopes: params.scopes,
		limit: Math.max(params.limit * 8, 64),
		readEpoch: params.readEpoch,
		docKinds: params.docKinds,
		docTypes: params.docTypes
	}).map((doc) => {
		const searchText = buildLexicalSearchText(doc.text);
		const score = terms.reduce((acc, term) => acc + (searchText.includes(term) ? .18 : 0), 0);
		return {
			docId: doc.docId,
			text: doc.text,
			metadata: doc.metadataJson,
			score,
			backend: "fts"
		};
	}).filter((hit) => hit.score > 0).sort((left, right) => right.score - left.score).slice(0, params.limit);
}
function mergeFtsHits(primary, fallback, limit) {
	if (fallback.length === 0) return primary.slice(0, limit);
	const merged = /* @__PURE__ */ new Map();
	for (const hit of [...primary, ...fallback]) {
		const existing = merged.get(hit.docId);
		if (!existing || hit.score > existing.score) merged.set(hit.docId, hit);
	}
	return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}
var SqliteFtsBackend = class {
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
				query: buildFtsMatchQuery(params.query)
			});
			if (hits.length > 0 && !hasCjkLexicalTerms(params.query)) return hits;
			return mergeFtsHits(hits, fallbackKeywordSearch(this.repo, params), params.limit);
		} catch {
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
};
//#endregion
export { SqliteFtsBackend };
