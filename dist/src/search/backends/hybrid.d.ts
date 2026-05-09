import type { SearchHit } from "../../types.js";
export declare function mergeHybridHits(query: string, keywordHits: SearchHit[], similarityHits: SearchHit[], limit: number): SearchHit[];
