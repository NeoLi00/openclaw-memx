import type { ConversationChunk, ConversationTask, MemoryOperationContext, TaskAssignmentDecision, TurnSemanticTaskProposal, TurnCaptureMessage } from "../types.js";
type TaskJudgeParams = {
    activeTask: ConversationTask | null;
    activeChunks: ConversationChunk[];
    recentTasks: ConversationTask[];
    recentChunksByTask: Record<string, ConversationChunk[]>;
    newMessages: TurnCaptureMessage[];
    ctx: MemoryOperationContext;
    taskProposal?: TurnSemanticTaskProposal;
};
export declare function buildDeterministicTaskProposal(params: Omit<TaskJudgeParams, "taskProposal">): TurnSemanticTaskProposal;
export declare function decideTaskAssignment(params: TaskJudgeParams): Promise<TaskAssignmentDecision>;
export declare function shouldStartNewTask(activeTask: ConversationTask | null, taskChunks: ConversationChunk[], newMessages: TurnCaptureMessage[], ctx: MemoryOperationContext, reasoner?: MemxReasoner): Promise<boolean>;
export {};
