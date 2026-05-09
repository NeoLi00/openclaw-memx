import type { ConversationChunk, ConversationTask, MemoryCandidateStructuredHints, MemoryOperationContext, TurnCaptureMessage, TurnSemanticFrame } from "../types.js";
type TurnSemanticCompilerReasoner = {
    isEnabled?: () => boolean;
    compileTurnSemantics?: (messages: TurnCaptureMessage[], fallback: TurnSemanticFrame) => Promise<Partial<TurnSemanticFrame> | null>;
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
export declare function frameHintsForSourceRef(frame: TurnSemanticFrame | undefined, sourceRef: string): Partial<MemoryCandidateStructuredHints> | undefined;
export declare function compileTurnSemantics(params: CompileTurnSemanticsParams): Promise<TurnSemanticFrame | undefined>;
export {};
