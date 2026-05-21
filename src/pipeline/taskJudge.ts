import type {
  ConversationChunk,
  ConversationTask,
  MemoryOperationContext,
  TaskAssignmentDecision,
  TurnSemanticTaskProposal,
  TurnCaptureMessage,
} from "../types.js";
import type { MemxReasoner } from "./reasoner.js";

type TaskJudgeParams = {
  activeTask: ConversationTask | null;
  activeChunks: ConversationChunk[];
  recentTasks: ConversationTask[];
  recentChunksByTask: Record<string, ConversationChunk[]>;
  newMessages: TurnCaptureMessage[];
  ctx: MemoryOperationContext;
  taskProposal?: TurnSemanticTaskProposal;
};

export async function decideTaskAssignment(
  params: TaskJudgeParams,
): Promise<TaskAssignmentDecision> {
  if (params.taskProposal && params.taskProposal.decision !== "none") {
    if (params.taskProposal.decision === "continue" && !params.activeTask) {
      return {
        decision: "new",
        confidence: 0.52,
        reason: "llm task proposal requested continue without an active task",
      };
    }
    if (
      params.taskProposal.decision === "resume" &&
      params.taskProposal.targetTaskId &&
      ![
        params.activeTask?.taskId,
        ...params.recentTasks.map((task) => task.taskId),
      ].includes(params.taskProposal.targetTaskId)
    ) {
      return params.activeTask
        ? {
            decision: "continue",
            confidence: 0.5,
            reason: "llm task proposal referenced an unavailable task",
          }
        : {
            decision: "new",
            confidence: 0.5,
            reason: "llm task proposal referenced an unavailable task",
          };
    }
    return {
      decision:
        params.taskProposal.decision === "resume" &&
        params.taskProposal.targetTaskId === params.activeTask?.taskId
          ? "continue"
          : params.taskProposal.decision,
      targetTaskId:
        params.taskProposal.decision === "resume" &&
        params.taskProposal.targetTaskId === params.activeTask?.taskId
          ? undefined
          : params.taskProposal.targetTaskId,
      confidence: params.taskProposal.confidence,
      reason: params.taskProposal.reason ?? "turn-semantic-compiler proposal",
    };
  }
  return params.activeTask
    ? {
        decision: "continue",
        confidence: 0.5,
        reason: "llm-only task assignment defaulted to active task",
      }
    : {
        decision: "new",
        confidence: 0.5,
        reason: "llm-only task assignment defaulted to new task",
      };
}

export async function shouldStartNewTask(
  activeTask: ConversationTask | null,
  taskChunks: ConversationChunk[],
  newMessages: TurnCaptureMessage[],
  ctx: MemoryOperationContext,
  reasoner?: MemxReasoner,
): Promise<boolean> {
  const decision = await decideTaskAssignment({
    activeTask,
    activeChunks: taskChunks,
    recentTasks: [],
    recentChunksByTask: {},
    newMessages,
    ctx,
    taskProposal: undefined,
  });
  return decision.decision === "new";
}
