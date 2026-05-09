import type { VectorRepo } from "../../db/repositories/vectorRepo.js";
import type { RetrievalBackend, RetrievalSearchParams, SearchHit, VectorDocRecord } from "../../types.js";
export declare class SqliteFtsBackend implements RetrievalBackend {
    private readonly repo;
    constructor(repo: VectorRepo);
    upsertDocs(docs: VectorDocRecord[]): void;
    deleteDocs(docIds: string[]): void;
    keywordSearch(params: RetrievalSearchParams): SearchHit[];
    similaritySearch(): Promise<SearchHit[]>;
    hybridSearch(params: RetrievalSearchParams): Promise<SearchHit[]>;
    embedTextsBatch(): Promise<number[][]>;
}
