import type {
  ConversationChunk,
  ConversationTask,
  MemoryOperationContext,
  TaskAssignmentDecision,
  TaskAssignmentSnapshot,
  TurnSemanticTaskProposal,
  TurnCaptureMessage,
} from "../types.js";
import { clamp01 } from "../support.js";
import { sanitizeTaskMetadata } from "./authority.js";
import { basicSemanticSimilarity } from "./semantic/textSimilarity.js";
import { parseWorkflowState } from "./semantics.js";
import { semanticTaskSummaryText } from "./taskSummary.js";

type TaskSignals = {
  project?: string;
  currentTask?: string;
  nextAction?: string;
  blocker?: string;
};

type TaskJudgeParams = {
  activeTask: ConversationTask | null;
  activeChunks: ConversationChunk[];
  recentTasks: ConversationTask[];
  recentChunksByTask: Record<string, ConversationChunk[]>;
  newMessages: TurnCaptureMessage[];
  ctx: MemoryOperationContext;
  taskProposal?: TurnSemanticTaskProposal;
};

type EvaluatedTaskCandidate = {
  snapshot: TaskAssignmentSnapshot;
  continuityScore: number;
  signalScore: number;
  contextScore: number;
  idleExpired: boolean;
};

function extractSignalsFromMessages(messages: TurnCaptureMessage[]): TaskSignals {
  const signals: TaskSignals = {};
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const parsed = parseWorkflowState(message.content);
    if (!parsed) {
      continue;
    }
    if (parsed.key === "project.active_project" && typeof parsed.value.project === "string") {
      signals.project = parsed.value.project.trim();
    } else if (parsed.key === "workflow.current_task" && typeof parsed.value.task === "string") {
      signals.currentTask = parsed.value.task.trim();
    } else if (parsed.key === "workflow.next_action" && typeof parsed.value.step === "string") {
      signals.nextAction = parsed.value.step.trim();
    } else if (parsed.key === "workflow.blocker" && typeof parsed.value.blocker === "string") {
      signals.blocker = parsed.value.blocker.trim();
    }
  }
  return signals;
}

function buildRecentUserContext(chunks: ConversationChunk[]): string {
  return chunks
    .filter((chunk) => chunk.role === "user")
    .slice(-4)
    .map((chunk) => chunk.content)
    .join("\n")
    .trim();
}

function buildTaskSnapshot(
  task: ConversationTask,
  chunks: ConversationChunk[],
  isActive: boolean,
): TaskAssignmentSnapshot {
  return {
    taskId: task.taskId,
    status: task.status,
    title: task.title,
    summary: semanticTaskSummaryText(task) ?? "",
    updatedAt: task.updatedAt,
    metadataJson: task.metadataJson,
    recentContext: buildRecentUserContext(chunks),
    isActive,
  };
}

function buildIncomingUserText(messages: TurnCaptureMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .trim();
}

function hasExplicitTaskBoundaryCue(text: string): boolean {
  return /(?:切到|换到|换个项目|另一个项目|switch(?:ing)? to|different project|another project|new topic)/iu.test(
    text,
  );
}

function effectiveDecisionNow(messages: TurnCaptureMessage[], fallbackNow: string): string {
  const observedAts = messages
    .map((message) => message.observedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return observedAts.at(-1) ?? fallbackNow;
}

function buildTaskReferenceText(snapshot: TaskAssignmentSnapshot): string {
  const canonicalMetadata = sanitizeTaskMetadata(snapshot.metadataJson);
  const metadataText = [
    canonicalMetadata.project ? `project ${canonicalMetadata.project}` : "",
    canonicalMetadata.currentTask ? `current task ${canonicalMetadata.currentTask}` : "",
    canonicalMetadata.nextAction ? `next action ${canonicalMetadata.nextAction}` : "",
    canonicalMetadata.blocker ? `blocker ${canonicalMetadata.blocker}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [snapshot.title, snapshot.summary, metadataText, snapshot.recentContext ?? ""]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function scoreSignalMatch(expected: string | undefined, actual: string | undefined): number | null {
  if (!expected || !actual) {
    return null;
  }
  return basicSemanticSimilarity(expected, actual);
}

function signalConsistencyScore(
  taskSignals: TaskSignals,
  incomingSignals: TaskSignals,
): number | null {
  const scores = [
    scoreSignalMatch(taskSignals.project, incomingSignals.project),
    scoreSignalMatch(taskSignals.currentTask, incomingSignals.currentTask),
    scoreSignalMatch(taskSignals.nextAction, incomingSignals.nextAction),
    scoreSignalMatch(taskSignals.blocker, incomingSignals.blocker),
  ].filter((score): score is number => score !== null);
  if (scores.length === 0) {
    return null;
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function recencyScore(updatedAt: string, now: string): number {
  const updated = new Date(updatedAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(updated) || !Number.isFinite(current)) {
    return 0.5;
  }
  const ageHours = Math.max(0, (current - updated) / (60 * 60 * 1000));
  if (ageHours <= 1) {
    return 1;
  }
  return Math.exp(-ageHours / 72);
}

function ageHours(updatedAt: string, now: string): number {
  const updated = new Date(updatedAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(updated) || !Number.isFinite(current)) {
    return 0;
  }
  return Math.max(0, (current - updated) / (60 * 60 * 1000));
}

function continuityScore(
  snapshot: TaskAssignmentSnapshot,
  incomingUserText: string,
  incomingSignals: TaskSignals,
  ctx: MemoryOperationContext,
): EvaluatedTaskCandidate {
  const referenceText = buildTaskReferenceText(snapshot);
  const metadata = sanitizeTaskMetadata(snapshot.metadataJson);
  const contextScore = incomingUserText ? basicSemanticSimilarity(referenceText, incomingUserText) : 0;
  const signalScore = signalConsistencyScore(
    {
      project: metadata.project,
      currentTask: metadata.currentTask,
      nextAction: metadata.nextAction,
      blocker: metadata.blocker,
    },
    incomingSignals,
  );
  const idleTimeoutHours = Math.max(0.25, ctx.config.advanced.taskIdleTimeoutMinutes / 60);
  const age = ageHours(snapshot.updatedAt, ctx.now);
  const idleExpired = snapshot.isActive && age > idleTimeoutHours;
  const exactProjectMatch =
    metadata.project && incomingSignals.project
      ? scoreSignalMatch(metadata.project, incomingSignals.project) ?? 0
      : 0;
  const exactTaskMatch =
    metadata.currentTask && incomingSignals.currentTask
      ? scoreSignalMatch(metadata.currentTask, incomingSignals.currentTask) ?? 0
      : 0;
  const projectTextMatch =
    metadata.project && incomingUserText
      ? basicSemanticSimilarity(metadata.project, incomingUserText)
      : 0;
  const taskTextMatch =
    metadata.currentTask && incomingUserText
      ? basicSemanticSimilarity(metadata.currentTask, incomingUserText)
      : 0;
  const softContextScore =
    incomingSignals.project || incomingSignals.currentTask || incomingSignals.nextAction || incomingSignals.blocker
      ? Math.min(0.5, contextScore)
      : Math.min(0.44, contextScore * 0.82);
  let continuity = Math.max(signalScore ?? 0, softContextScore);
  if (exactProjectMatch >= 0.82) {
    continuity = Math.max(continuity, 0.84);
  }
  if (exactTaskMatch >= 0.8) {
    continuity = Math.max(continuity, 0.88);
  }
  if (projectTextMatch >= 0.7) {
    continuity = Math.max(continuity, 0.78);
  }
  if (taskTextMatch >= 0.68) {
    continuity = Math.max(continuity, 0.82);
  }
  if (snapshot.isActive && !idleExpired) {
    continuity = Math.max(
      continuity,
      incomingSignals.project || incomingSignals.currentTask ? 0.42 : 0.34,
    );
  }
  continuity = clamp01(continuity);
  return {
    snapshot,
    continuityScore: continuity,
    signalScore: signalScore ?? 0,
    contextScore,
    idleExpired,
  };
}

function chooseHeuristicAssignment(
  activeSnapshot: TaskAssignmentSnapshot | null,
  candidateSnapshots: TaskAssignmentSnapshot[],
  incomingUserText: string,
  incomingSignals: TaskSignals,
  ctx: MemoryOperationContext,
): TaskAssignmentDecision {
  if (hasExplicitTaskBoundaryCue(incomingUserText)) {
    return {
      decision: "new",
      confidence: 0.82,
      reason: "boundary gate: the new turn explicitly switches to a different task",
    };
  }
  const evaluated = candidateSnapshots
    .map((snapshot) => continuityScore(snapshot, incomingUserText, incomingSignals, ctx))
    .sort((left, right) => right.continuityScore - left.continuityScore);
  const activeScore = activeSnapshot
    ? evaluated.find((entry) => entry.snapshot.taskId === activeSnapshot.taskId)
    : undefined;
  const bestOther = evaluated.find((entry) => !entry.snapshot.isActive);

  if (
    activeScore &&
    !activeScore.idleExpired &&
    activeScore.continuityScore >= 0.5 &&
    activeScore.continuityScore >= (bestOther?.continuityScore ?? 0) - 0.04
  ) {
    return {
      decision: "continue",
      confidence: Math.min(0.9, Math.max(0.56, activeScore.continuityScore)),
      reason: "continuity gate: active task retains enough validated continuity",
    };
  }

  if (
    bestOther &&
    bestOther.continuityScore >= 0.72 &&
    bestOther.continuityScore >= (activeScore?.continuityScore ?? 0) + 0.12
  ) {
    return {
      decision: "resume",
      targetTaskId: bestOther.snapshot.taskId,
      confidence: Math.min(0.9, Math.max(0.58, bestOther.continuityScore)),
      reason: "continuity gate: a recent task has stronger validated continuity",
    };
  }

  if (
    activeScore &&
    !activeScore.idleExpired &&
    (incomingSignals.project || incomingSignals.currentTask || activeScore.continuityScore >= 0.36)
  ) {
    return {
      decision: "continue",
      confidence: Math.min(0.82, Math.max(0.5, activeScore.continuityScore)),
      reason: "continuity gate: preserve the active task unless a clearer boundary appears",
    };
  }

  return {
    decision: "new",
    confidence: bestOther ? Math.max(0.54, 1 - bestOther.continuityScore * 0.55) : 0.62,
    reason: "continuity gate: no task passed the conservative continuity checks",
  };
}

function shouldForceHeuristicTaskAssignment(ctx: MemoryOperationContext): boolean {
  return ctx.channelId === "longmemeval" && ctx.runId?.startsWith("lme-replay:") === true;
}

export function buildDeterministicTaskProposal(
  params: Omit<TaskJudgeParams, "taskProposal">,
): TurnSemanticTaskProposal {
  const decisionNow = effectiveDecisionNow(params.newMessages, params.ctx.now);
  const decisionCtx =
    decisionNow === params.ctx.now
      ? params.ctx
      : {
          ...params.ctx,
          now: decisionNow,
        };
  const incomingUserText = buildIncomingUserText(params.newMessages);
  const incomingSignals = extractSignalsFromMessages(params.newMessages);
  const dedupedRecent = params.recentTasks.filter(
    (task, index, array) =>
      task.taskId !== params.activeTask?.taskId &&
      array.findIndex((candidate) => candidate.taskId === task.taskId) === index,
  );

  const activeSnapshot = params.activeTask
    ? buildTaskSnapshot(params.activeTask, params.activeChunks, true)
    : null;
  const candidateSnapshots = [
    ...(activeSnapshot ? [activeSnapshot] : []),
    ...dedupedRecent.map((task) =>
      buildTaskSnapshot(task, params.recentChunksByTask[task.taskId] ?? [], false),
    ),
  ];

  if (!params.activeTask && candidateSnapshots.length === 0) {
    return {
      decision: "new",
      confidence: 0.98,
      reason: "no active or recent task is available",
    };
  }

  if (!incomingUserText.trim()) {
    return params.activeTask
      ? {
          decision: "continue",
          confidence: 0.74,
          reason: "no new user intent was captured, so keep the active task",
        }
      : {
          decision: "new",
          confidence: 0.7,
          reason: "no user message was captured, so start a fresh task boundary",
        };
  }

  const heuristicDecision = chooseHeuristicAssignment(
    activeSnapshot,
    candidateSnapshots,
    incomingUserText,
    incomingSignals,
    decisionCtx,
  );
  return {
    decision: heuristicDecision.decision,
    targetTaskId: heuristicDecision.targetTaskId,
    confidence: heuristicDecision.confidence,
    reason: heuristicDecision.reason,
  };
}

export async function decideTaskAssignment(
  params: TaskJudgeParams,
): Promise<TaskAssignmentDecision> {
  const heuristicDecision = buildDeterministicTaskProposal(params);
  if (shouldForceHeuristicTaskAssignment(params.ctx)) {
    // LongMemEval replay is offline indexing, not an interactive boundary
    // decision. Keep the replay path deterministic.
    return heuristicDecision;
  }
  if (params.taskProposal && params.taskProposal.decision !== "none") {
    if (params.taskProposal.decision === "continue" && !params.activeTask) {
      return heuristicDecision;
    }
    if (
      params.taskProposal.decision === "resume" &&
      params.taskProposal.targetTaskId &&
      ![
        params.activeTask?.taskId,
        ...params.recentTasks.map((task) => task.taskId),
      ].includes(params.taskProposal.targetTaskId)
    ) {
      return heuristicDecision;
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
  return heuristicDecision;
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
