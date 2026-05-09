import type { MemxStoreBundle } from "../runtime.js";
import type { CandidateHit, CandidateSurface, EvidencePlanLayer, LayerCandidateHit, MemoryOperationContext, QueryCompileResult, SearchHit } from "../types.js";
export type CandidateGenerationSurfaceStats = {
    rawCount: number;
    filteredCount: number;
    alternateCount: number;
    topN: number;
    backendMix: Array<"embedding" | "fts" | "hybrid" | "lexical" | "repo">;
};
export type CandidateGenerationSlotLayerStats = {
    slotId: string;
    layer: EvidencePlanLayer;
    rawCount: number;
    selectedCount: number;
    alternateCount: number;
    topCandidateIds: string[];
};
export type CandidateGenerationResult = {
    candidates: CandidateHit[];
    slotCandidates: CandidateHit[];
    bridgeCandidates: CandidateHit[];
    searchHits: SearchHit[];
    alternateSearchHits: SearchHit[];
    surfaceStats: Partial<Record<CandidateSurface, CandidateGenerationSurfaceStats>>;
    slotLayerStats: CandidateGenerationSlotLayerStats[];
    layerCandidates: LayerCandidateHit[];
    budgets: Partial<Record<CandidateSurface, number>>;
};
export declare function generateCandidates(store: MemxStoreBundle, ctx: MemoryOperationContext, compiled: QueryCompileResult): Promise<CandidateGenerationResult>;
export declare function candidateGenerationAuditPayload(result: CandidateGenerationResult): Record<string, unknown>;
