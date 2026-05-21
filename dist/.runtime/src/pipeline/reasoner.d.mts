import { AbstractionCandidateRecord, AbstractionCandidateStage, ConversationChunk, MemoryAction, MemoryCallProvenance, MemoryCandidate, MemoryCandidateDecisionHint, MemoryCandidatePreferenceHint, MemoryCandidateRelationHint, MemoryCandidateWorkflowHint, MemoryLlmBudgetAudit, MemoryLlmCallStage, MemoryPluginConfig, MemoryPrimaryRouteType, MemoryRecallPlan, MemxLogger, QueryCompileResult, RouteDecision, RouteEvidenceCandidate, RouteEvidenceDecision, RoutePriorDecision, SearchHit, SynthesizedTaskEvent, TaskAssignmentDecision, TaskAssignmentSnapshot, TurnCaptureMessage, TurnSemanticFrame } from "../types.mjs";
import { SupportedJudgeProvider } from "./judgeModelConfig.mjs";
import { TaskSummaryEvidenceSet } from "./taskSummary.mjs";
import { LongTurnSemanticScanInput } from "./turnSemanticCompiler.mjs";

//#region src/pipeline/reasoner.d.ts
type ReasonerExecutionMode = "llm" | "degraded" | "disabled";
type ReasonerTraceEntry = {
  label: string;
  mode: ReasonerExecutionMode;
  provenance: MemoryCallProvenance;
  detail: string;
  stage?: MemoryLlmCallStage;
  provider?: SupportedJudgeProvider;
  model?: string;
  at: string;
};
type ReasonerCallAuditOptions = {
  stage?: MemoryLlmCallStage;
  audit?: MemoryLlmBudgetAudit;
  maxTokens?: number;
  jsonMode?: boolean;
  temperature?: number;
  signal?: AbortSignal;
};
type DedupDecision = {
  action: "NEW" | "DUPLICATE" | "UPDATE";
  targetIndex?: number;
  mergedSummary?: string;
  reason: string;
};
type OutcomePromotionDecision = {
  shouldPromote: boolean;
  promotionScore: number;
  reason: string;
};
type RelevantDecision = {
  relevant: number[];
  sufficient: boolean;
  reason: string;
};
type TaskSummary = {
  title: string;
  summary: string;
  metadataJson: Record<string, unknown>;
  synthesizedEvent?: Omit<SynthesizedTaskEvent, "evidenceChunkIds" | "outcomeKey"> & {
    evidenceChunkIndexes: number[];
  };
};
type AbstractionCandidateJudgeResult = {
  summary?: string;
  displayName?: string | null;
  stage?: AbstractionCandidateStage;
  reason?: string;
};
type CandidatePolicyJudgeResult = {
  action?: MemoryAction;
  salienceScore?: number;
  expectedFutureUtility?: number;
  stabilityScore?: number;
  preference?: MemoryCandidatePreferenceHint | null;
  workflow?: MemoryCandidateWorkflowHint | null;
  workflows?: MemoryCandidateWorkflowHint[] | null;
  relation?: MemoryCandidateRelationHint | null;
  relations?: MemoryCandidateRelationHint[] | null;
  decision?: MemoryCandidateDecisionHint | null;
  reason?: string;
};
type ReasonerProbeReport = {
  enabled: boolean;
  resolvedConfigPath: string | null;
  provider: SupportedJudgeProvider | null;
  model: string | null;
  traces: ReasonerTraceEntry[];
  outputs: {
    chunkSummary: string;
    taskTitle: string;
    taskSummary: string;
    topicDecision: boolean | null;
    dedupAction: string | null;
    relevant: number[];
    recallPlan: string;
  };
};
declare function sanitizeChunkSummaryResult(text: string, role?: ConversationChunk["role"], result?: ChunkSummaryJudgeResult | null): string;
type ChunkSummaryJudgeResult = {
  summary?: string;
  summaryKind?: "question" | "instruction" | "statement" | "answer" | "mixed";
  answerSupported?: boolean;
};
type ConsolidationBatchConfirmItem = {
  id: string;
  kind: "fact" | "relation";
  predicate: string;
  object: string;
  subject?: string;
  supportCount: number;
  latestObservedAt?: string;
  structuredSummaries: string[];
  sourceRefs: string[];
};
declare class MemxReasoner {
  private readonly config;
  private readonly logger;
  private readonly judgeModel;
  private readonly warned;
  private traces;
  constructor(config: MemoryPluginConfig, logger: MemxLogger);
  summarizeChunk(text: string, role?: ConversationChunk["role"], options?: ReasonerCallAuditOptions & {
    allowLlm?: boolean;
  }): Promise<string>;
  summarizeTask(chunks: ConversationChunk[], options?: ReasonerCallAuditOptions & {
    allowLlm?: boolean;
  }): Promise<TaskSummary>;
  summarizeTaskFromEvidence(evidence: TaskSummaryEvidenceSet, options?: ReasonerCallAuditOptions): Promise<TaskSummary | null>;
  summarizeTaskEvidenceBatch(evidenceSets: TaskSummaryEvidenceSet[], options?: ReasonerCallAuditOptions): Promise<Map<string, TaskSummary> | null>;
  confirmConsolidationBatch(items: ConsolidationBatchConfirmItem[], options?: ReasonerCallAuditOptions): Promise<Map<string, {
    decision: "confirm" | "defer" | "reject";
    reason?: string;
  }> | null>;
  judgeTaskAssignment(currentTask: TaskAssignmentSnapshot | null, candidates: TaskAssignmentSnapshot[], incomingTurn: string): Promise<TaskAssignmentDecision | null>;
  judgeNewTopic(currentContext: string, newMessage: string): Promise<boolean | null>;
  judgeDedup(newSummary: string, sourceText: string, candidates: Array<{
    index: number;
    summary: string;
    text?: string;
  }>): Promise<DedupDecision | null>;
  filterRelevant(query: string, candidates: Array<{
    index: number;
    summary: string;
    role: string;
  }>): Promise<RelevantDecision | null>;
  planRecall(query: string): Promise<MemoryRecallPlan>;
  judgeRoutePrior(query: string): Promise<RoutePriorDecision>;
  /**
   * Combined single-LLM-call version of planRecall + judgeRoutePrior.
   * Saves one sequential LLM round-trip (~3.7s) by asking a single prompt
   * that covers both recall planning and route prior selection.
   */
  planRecallWithRoute(query: string): Promise<{
    plan: MemoryRecallPlan;
    routePrior: RoutePriorDecision;
  }>;
  compileQuerySemantics(query: string, fallback: QueryCompileResult, options?: ReasonerCallAuditOptions): Promise<Partial<QueryCompileResult> | null>;
  compileTurnSemantics(messages: TurnCaptureMessage[], fallback: TurnSemanticFrame, options?: ReasonerCallAuditOptions): Promise<Partial<TurnSemanticFrame> | null>;
  compileLongTurnSemantics(input: LongTurnSemanticScanInput, fallback: TurnSemanticFrame, options?: ReasonerCallAuditOptions): Promise<Partial<TurnSemanticFrame> | null>;
  judgeRouteEvidence(query: string, routeType: MemoryPrimaryRouteType, candidates: RouteEvidenceCandidate[]): Promise<RouteEvidenceDecision>;
  judgeOutcomePromotion(task: TaskAssignmentSnapshot, proposal: SynthesizedTaskEvent, evidenceChunks: ConversationChunk[]): Promise<OutcomePromotionDecision>;
  judgeAbstractionCandidate(candidate: AbstractionCandidateRecord, options?: ReasonerCallAuditOptions): Promise<AbstractionCandidateJudgeResult | null>;
  judgeCandidatePolicy(candidate: MemoryCandidate, options?: ReasonerCallAuditOptions): Promise<CandidatePolicyJudgeResult | null>;
  confirmConsolidationFact(text: string, preference: {
    predicate: string;
    object: string;
  }, options?: ReasonerCallAuditOptions): Promise<boolean>;
  confirmConsolidationRelation(text: string, relation: {
    subject: string;
    predicate: string;
    object: string;
  }, options?: ReasonerCallAuditOptions): Promise<boolean>;
  judgeQueryRouteWithLlm(query: string): Promise<RouteDecision | null>;
  validateStrategyCluster(entries: Array<{
    domain: string;
    resolution: string;
  }>): Promise<boolean>;
  getResolvedJudgeModel(): {
    provider: SupportedJudgeProvider;
    model: string;
  } | null;
  getResolvedJudgeConfigPath(): string | null;
  getTrace(): ReasonerTraceEntry[];
  clearTrace(): void;
  runProbeSuite(): Promise<ReasonerProbeReport>;
  private callJson;
  private recordTrace;
  isEnabled(): boolean;
}
declare function roleLabelForHit(hit: SearchHit): string;
//#endregion
export { sanitizeChunkSummaryResult };