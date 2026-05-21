import { ConversationChunk, ConversationTask, MemoryCandidateStructuredHints, MemoryLlmBudgetAudit, MemoryLlmCallStage, MemoryOperationContext, SourceSegmentRecord, TurnCaptureMessage, TurnSemanticFrame, TurnSemanticReferenceContext } from "../types.mjs";

//#region src/pipeline/turnSemanticCompiler.d.ts
type TurnSemanticMessageWindowKind = "full" | "head" | "tail" | "latest_instruction";
type TurnSemanticMessageWindow = {
  kind: TurnSemanticMessageWindowKind;
  start: number;
  end: number;
  text: string;
};
type TurnSemanticCompilerMessageInput = {
  role: TurnCaptureMessage["role"];
  sourceRef: string;
  turnId: string;
  rawLength: number;
  rawHash: string;
  truncated: boolean;
  visibleChars: number;
  omittedChars: number;
  windows: TurnSemanticMessageWindow[];
};
type TurnSemanticCompilerInput = {
  messages: TurnSemanticCompilerMessageInput[];
  recentReferenceContext?: TurnSemanticReferenceContext;
};
type LongTurnSemanticScanSegment = {
  index: number;
  start: number;
  end: number;
  text: string;
  truncated: boolean;
};
type LongTurnSemanticScanMessage = {
  role: TurnCaptureMessage["role"];
  sourceRef: string;
  turnId: string;
  rawLength: number;
  rawHash: string;
  segmentCount: number;
  selectedSegmentCount: number;
  omittedSegmentCount: number;
  segments: LongTurnSemanticScanSegment[];
};
type LongTurnSemanticScanInput = {
  messages: LongTurnSemanticScanMessage[];
  recentReferenceContext?: TurnSemanticReferenceContext;
};
type TurnSemanticCompilerReasonerOptions = {
  stage?: MemoryLlmCallStage;
  audit?: MemoryLlmBudgetAudit;
};
type TurnSemanticCompilerReasoner = {
  isEnabled?: () => boolean;
  compileTurnSemantics?: (messages: TurnCaptureMessage[], fallback: TurnSemanticFrame, options?: TurnSemanticCompilerReasonerOptions) => Promise<Partial<TurnSemanticFrame> | null>;
};
type CompileTurnSemanticsParams = {
  messages: TurnCaptureMessage[];
  ctx: MemoryOperationContext;
  activeTask?: ConversationTask | null;
  activeChunks?: ConversationChunk[];
  recentTasks?: ConversationTask[];
  recentChunksByTask?: Record<string, ConversationChunk[]>;
  reasoner?: TurnSemanticCompilerReasoner;
};
declare function buildTurnSemanticCompilerInput(messages: TurnCaptureMessage[], referenceContext?: TurnSemanticReferenceContext): TurnSemanticCompilerInput;
declare function buildLongTurnSemanticScanInputFromSegments(segments: SourceSegmentRecord[], recentReferenceContext?: TurnSemanticReferenceContext): LongTurnSemanticScanInput;
declare function frameHintsForSourceRef(frame: TurnSemanticFrame | undefined, sourceRef: string): Partial<MemoryCandidateStructuredHints> | undefined;
declare function compileTurnSemantics(params: CompileTurnSemanticsParams): Promise<TurnSemanticFrame | undefined>;
//#endregion
export { LongTurnSemanticScanInput, compileTurnSemantics };