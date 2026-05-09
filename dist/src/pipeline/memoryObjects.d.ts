import type { MemxStoreBundle } from "../runtime.js";
import type { BackgroundRecallBundle, BudgetedMemorySelection, MemoryObject, MemoryObjectKind, MemoryOperationContext, MemoryRouteType, MemoryPrimaryRouteType, MemorySelectionObjective, NormalizedFact, RecallBudgetPlan, RouteEvidenceCandidate, ScheduledMemoryObject, SearchHit } from "../types.js";
export declare function collectBehavioralGuidance(store: MemxStoreBundle, ctx: MemoryOperationContext): string[];
export declare function buildBackgroundRecallBundle(store: MemxStoreBundle, ctx: MemoryOperationContext): BackgroundRecallBundle;
export declare function queryMemoryFacts(params: {
    store: MemxStoreBundle;
    ctx: MemoryOperationContext;
    text: string;
    limit: number;
    includeHistorical: boolean;
}): NormalizedFact[];
export declare function collectMemoryObjects(store: MemxStoreBundle, ctx: MemoryOperationContext, objective: MemorySelectionObjective, hybridHits: SearchHit[]): MemoryObject[];
export declare function scheduleMemoryObjects(objects: MemoryObject[], objective: MemorySelectionObjective): ScheduledMemoryObject[];
export declare function collectAndScheduleMemoryObjects(store: MemxStoreBundle, ctx: MemoryOperationContext, objective: MemorySelectionObjective, hybridHits: SearchHit[]): ScheduledMemoryObject[];
export declare function collectAndScheduleMemoryObjectsWithBudget(store: MemxStoreBundle, ctx: MemoryOperationContext, plan: RecallBudgetPlan, hybridHits: SearchHit[]): BudgetedMemorySelection;
export declare function topScheduledMemoryScore(scheduled: ScheduledMemoryObject[], predicate?: (entry: ScheduledMemoryObject) => boolean): number;
export declare function topProbeSupportForRoute(scheduled: ScheduledMemoryObject[], routeType: MemoryPrimaryRouteType): {
    support: number;
    topEntry?: ScheduledMemoryObject;
};
export declare function routeHintFromMemoryObjectKind(kind: MemoryObjectKind): MemoryRouteType | undefined;
export declare function toRouteEvidenceCandidatesFromObjects(scheduled: ScheduledMemoryObject[], limit: number): RouteEvidenceCandidate[];
