import type { MemxStoreBundle } from "../runtime.js";
import type { MemoryOperationContext, MaintenanceBatchMetadata, MaintenanceAuthoritySource, MaintenanceSemanticSource } from "../types.js";
type MaintenanceCallSummary = {
    callCount: number;
    estimatedPromptTokens: number;
    estimatedCompletionTokens: number;
    estimatedTotalTokens: number;
    elapsedMs: number;
};
type ConsolidationMaintenanceStats = {
    batch?: MaintenanceBatchMetadata & {
        delta: {
            eventsConsidered: number;
            tasksConsidered: number;
            lowerWatermarks: MaintenanceBatchMetadata["lowerWatermarks"];
            upperWatermarks: MaintenanceBatchMetadata["upperWatermarks"];
        };
    };
    expiredStates: number;
    promotedFacts: number;
    promotedEdges: number;
    promotedStates: number;
    prunedEdges: number;
    beliefsUpserted: number;
    beliefSignalsProcessed: number;
    beliefsNeedingReevaluation: number;
    beliefsPromoted: number;
    beliefsDemoted: number;
    beliefsQuarantined: number;
    beliefsSuperseded: number;
    beliefsDecaying: number;
    strategiesUpserted: number;
    activeStrategies: number;
    candidateStrategies: number;
    quarantinedStrategies: number;
    stageTimingsMs: {
        hygiene: number;
        beliefAggregation: number;
        semanticUpgrade: number;
        structureDerivation: number;
        total: number;
    };
    budgets: {
        maxConsolidationConfirmationsPerKind: number;
        eligibleFactConfirmations: number;
        eligibleRelationConfirmations: number;
        attemptedFactConfirmations: number;
        attemptedRelationConfirmations: number;
        maxTaskSummaryUpgrades: number;
        eligibleTaskSummaryUpgrades: number;
        attemptedTaskSummaryUpgrades: number;
        skippedTaskSummaryUpgrades: number;
        taskSummaryTimeoutMs: number;
        maxStrategyEmbeddingCandidates: number;
        strategyEmbeddingCandidatesEmbedded: number;
    };
    semanticUpgrade: {
        factConfirmDeferred: number;
        relationConfirmDeferred: number;
        factConfirmRejected: number;
        relationConfirmRejected: number;
        confirmFallbackTriggered: boolean;
        taskSummariesUpgraded: number;
        taskSummaryUpgradeFailures: number;
        taskSummaryUpgradeTimedOut: number;
        skippedReasons: string[];
        confirmationGroups: {
            factGroupKeys: string[];
            relationGroupKeys: string[];
            selectedFactGroupKeys: string[];
            selectedRelationGroupKeys: string[];
        };
        llm: {
            taskSummaryUpgrade: MaintenanceCallSummary;
            consolidationConfirm: MaintenanceCallSummary;
        };
    };
    authoritySources: {
        hygiene: MaintenanceAuthoritySource[];
        beliefAggregation: MaintenanceAuthoritySource[];
        semanticUpgrade: MaintenanceAuthoritySource[];
        structureDerivation: MaintenanceAuthoritySource[];
    };
    semanticSources: {
        hygiene: MaintenanceSemanticSource[];
        beliefAggregation: MaintenanceSemanticSource[];
        semanticUpgrade: MaintenanceSemanticSource[];
        structureDerivation: MaintenanceSemanticSource[];
    };
    maintenanceContractDiagnostics?: Record<string, unknown>;
    recallFacingDiagnostics?: Record<string, unknown>;
};
export declare function runConsolidation(store: MemxStoreBundle, ctx: MemoryOperationContext, options?: {
    batch?: MaintenanceBatchMetadata;
}): Promise<ConsolidationMaintenanceStats>;
export {};
