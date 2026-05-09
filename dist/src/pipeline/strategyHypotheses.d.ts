import type { MemxStoreBundle } from "../runtime.js";
import type { MaintenanceAuthoritySource, MaintenanceSemanticSource, MemoryOperationContext, StrategyHypothesisRecord } from "../types.js";
export type WorkflowPatternSummary = {
    scope: string;
    domainKey: string;
    summary: string;
    supportBeliefIds: string[];
    supportTaskIds: string[];
    confidence: number;
    usefulnessScore: number;
    stabilityScore: number;
    contradictionScore: number;
    metadataJson: Record<string, unknown>;
};
export type StrategyDerivationStats = {
    strategiesUpserted: number;
    activeStrategies: number;
    candidateStrategies: number;
    quarantinedStrategies: number;
    embeddingBudget: number;
    embeddingCandidatesConsidered: number;
    embeddingCandidatesEmbedded: number;
    authoritySource: MaintenanceAuthoritySource;
    semanticSources: MaintenanceSemanticSource[];
};
export declare function inferStrategyHypothesisStage(params: {
    confidence: number;
    usefulnessScore: number;
    stabilityScore: number;
    contradictionScore: number;
    groundedByRoles?: string[];
    taskPhase?: string;
    explicitInstruction?: boolean;
    groundedResolution?: boolean;
}): StrategyHypothesisRecord["stage"];
export declare function deriveStrategyHypotheses(store: MemxStoreBundle, ctx: MemoryOperationContext): Promise<StrategyDerivationStats>;
export declare function deriveWorkflowPatternSummaries(store: MemxStoreBundle, ctx: MemoryOperationContext): Promise<WorkflowPatternSummary[]>;
