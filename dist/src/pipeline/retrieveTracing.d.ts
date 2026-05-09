import type { BackgroundRecallBundle, EvidenceRow, MemoryRecallPlan, QueryCompileResult, RecallQueryShape, RecallBudgetPlan, RecallControllerTrace, RecallProbeDecision, RecallQualityGateDecision, RecallSelectionTrace, TurnMode, ShallowRecallResult } from "../types.js";
export type RetrievalAuditOptions = {
    recallMode?: "full" | "background-only" | "no-recall";
    fullRecallTrigger?: "plan" | "probe" | "both" | "tool";
    plan?: MemoryRecallPlan;
    probe?: RecallProbeDecision;
    controller?: RecallControllerTrace;
    shallow?: ShallowRecallResult;
    qualityGate?: RecallQualityGateDecision;
    background?: BackgroundRecallBundle;
    budgetPlan?: RecallBudgetPlan;
    selectionTrace?: RecallSelectionTrace;
    queryAnalysis?: {
        queryShape: RecallQueryShape;
        routeWeights: Record<string, number> | Partial<Record<string, number>>;
        turnMode: TurnMode;
        answerGranularity?: QueryCompileResult["answerGranularity"];
        evidenceFidelity?: QueryCompileResult["evidenceFidelity"];
        candidateSurfaces?: QueryCompileResult["candidateSurfaces"];
        evidenceGoals?: QueryCompileResult["evidenceGoals"];
        supportNeed?: number;
        ambiguityLevel?: number;
        compilerProvenance?: QueryCompileResult["compilerProvenance"];
    };
};
export declare function summarizeBackgroundRecallBundle(bundle: BackgroundRecallBundle): {
    guidanceCount: number;
    strategyCount: number;
    stateIds: string[];
    taskIds: string[];
    projectionRoles: string[];
    projectionBlocks: Array<{
        blockId: string;
        role: string;
        title: string;
        sourceIds: string[];
        lineCount: number;
        charCount: number;
    }>;
};
export declare function sanitizeFocusedRecallQuery(rawQuery: string, focusedQuery?: string): string;
export declare function formatRecallProbeTrace(probe: RecallProbeDecision): string;
export declare function formatRecallControllerTrace(controller: RecallControllerTrace): string;
export declare function formatShallowRecallTrace(shallow: ShallowRecallResult): string;
export declare function formatRecallQualityGateTrace(gate: RecallQualityGateDecision): string;
export declare function buildRecallAuditPayload(options?: RetrievalAuditOptions): Record<string, unknown> | undefined;
export declare function compareEvidenceRowsChronologically(left: EvidenceRow, right: EvidenceRow): number;
