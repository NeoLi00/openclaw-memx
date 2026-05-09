import type { MemxStoreBundle } from "../runtime.js";
import type { BackgroundRecallBundle, EvidenceBundle, QueryCompileResult, RecallBudgetPlan, RecallControllerTrace, RecallQualityGateDecision, ShallowRecallResult, MemoryRecallPlan, MemoryOperationContext, RecallProbeDecision, SearchHit } from "../types.js";
import { type RetrievalAuditOptions } from "./retrieveTracing.js";
export type RecallQueryAnalysis = QueryCompileResult;
export declare function analyzeRecallQuery(query: string): RecallQueryAnalysis;
export declare function buildBackgroundRecallBundle(store: MemxStoreBundle, ctx: MemoryOperationContext): BackgroundRecallBundle;
export declare function hasBackgroundRecallMaterial(bundle: BackgroundRecallBundle): boolean;
export declare function evaluateRecallController(params: {
    query: string;
    background: BackgroundRecallBundle;
    plan: MemoryRecallPlan;
    probe: RecallProbeDecision;
    queryAnalysis?: RecallQueryAnalysis;
    legacyTrigger: "plan" | "probe" | "both" | "none";
}): RecallControllerTrace;
export declare function runShallowRecall(store: MemxStoreBundle, ctx: MemoryOperationContext, query: string, searchQuery?: string, background?: BackgroundRecallBundle): Promise<ShallowRecallResult>;
export declare function evaluateRecallQualityGate(params: {
    query: string;
    searchQuery: string;
    background: BackgroundRecallBundle;
    plan: MemoryRecallPlan;
    probe: RecallProbeDecision;
    controller: RecallControllerTrace;
    shallow: ShallowRecallResult;
}): RecallQualityGateDecision;
export declare function runRecallProbe(store: MemxStoreBundle, ctx: MemoryOperationContext, query: string, searchQuery?: string, background?: BackgroundRecallBundle): Promise<RecallProbeDecision>;
export declare function planRecallAllocation(store: MemxStoreBundle, ctx: MemoryOperationContext, query: string, searchQuery: string, hybridHits: SearchHit[], queryAnalysis?: RecallQueryAnalysis): Promise<RecallBudgetPlan>;
export declare function retrieveEvidence(store: MemxStoreBundle, ctx: MemoryOperationContext, query: string, searchQuery?: string, auditOptions?: RetrievalAuditOptions & {
    queryAnalysis?: RecallQueryAnalysis;
}): Promise<EvidenceBundle>;
export declare function renderEvidenceBundle(bundle: EvidenceBundle, maxChars: number): string;
