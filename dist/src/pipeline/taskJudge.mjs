import { clamp01 } from "../support.mjs";
import { basicSemanticSimilarity } from "./semantic/textSimilarity.mjs";
import { parseWorkflowState } from "./semantics.mjs";
import { sanitizeTaskMetadata } from "./authority.mjs";
import { semanticTaskSummaryText } from "./taskSummary.mjs";
//#region src/pipeline/taskJudge.ts
function extractSignalsFromMessages(messages) {
	const signals = {};
	for (const message of messages) {
		if (message.role !== "user") continue;
		const parsed = parseWorkflowState(message.content);
		if (!parsed) continue;
		if (parsed.key === "project.active_project" && typeof parsed.value.project === "string") signals.project = parsed.value.project.trim();
		else if (parsed.key === "workflow.current_task" && typeof parsed.value.task === "string") signals.currentTask = parsed.value.task.trim();
		else if (parsed.key === "workflow.next_action" && typeof parsed.value.step === "string") signals.nextAction = parsed.value.step.trim();
		else if (parsed.key === "workflow.blocker" && typeof parsed.value.blocker === "string") signals.blocker = parsed.value.blocker.trim();
	}
	return signals;
}
function buildRecentUserContext(chunks) {
	return chunks.filter((chunk) => chunk.role === "user").slice(-4).map((chunk) => chunk.content).join("\n").trim();
}
function buildTaskSnapshot(task, chunks, isActive) {
	return {
		taskId: task.taskId,
		status: task.status,
		title: task.title,
		summary: semanticTaskSummaryText(task) ?? "",
		updatedAt: task.updatedAt,
		metadataJson: task.metadataJson,
		recentContext: buildRecentUserContext(chunks),
		isActive
	};
}
function buildIncomingUserText(messages) {
	return messages.filter((message) => message.role === "user").map((message) => message.content).join("\n").trim();
}
function hasExplicitTaskBoundaryCue(text) {
	return /(?:切到|换到|换个项目|另一个项目|switch(?:ing)? to|different project|another project|new topic)/iu.test(text);
}
function effectiveDecisionNow(messages, fallbackNow) {
	return messages.map((message) => message.observedAt).filter((value) => typeof value === "string" && value.length > 0).sort().at(-1) ?? fallbackNow;
}
function buildTaskReferenceText(snapshot) {
	const canonicalMetadata = sanitizeTaskMetadata(snapshot.metadataJson);
	const metadataText = [
		canonicalMetadata.project ? `project ${canonicalMetadata.project}` : "",
		canonicalMetadata.currentTask ? `current task ${canonicalMetadata.currentTask}` : "",
		canonicalMetadata.nextAction ? `next action ${canonicalMetadata.nextAction}` : "",
		canonicalMetadata.blocker ? `blocker ${canonicalMetadata.blocker}` : ""
	].filter(Boolean).join("\n");
	return [
		snapshot.title,
		snapshot.summary,
		metadataText,
		snapshot.recentContext ?? ""
	].filter(Boolean).join("\n").trim();
}
function scoreSignalMatch(expected, actual) {
	if (!expected || !actual) return null;
	return basicSemanticSimilarity(expected, actual);
}
function signalConsistencyScore(taskSignals, incomingSignals) {
	const scores = [
		scoreSignalMatch(taskSignals.project, incomingSignals.project),
		scoreSignalMatch(taskSignals.currentTask, incomingSignals.currentTask),
		scoreSignalMatch(taskSignals.nextAction, incomingSignals.nextAction),
		scoreSignalMatch(taskSignals.blocker, incomingSignals.blocker)
	].filter((score) => score !== null);
	if (scores.length === 0) return null;
	return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}
function ageHours(updatedAt, now) {
	const updated = new Date(updatedAt).getTime();
	const current = new Date(now).getTime();
	if (!Number.isFinite(updated) || !Number.isFinite(current)) return 0;
	return Math.max(0, (current - updated) / (3600 * 1e3));
}
function continuityScore(snapshot, incomingUserText, incomingSignals, ctx) {
	const referenceText = buildTaskReferenceText(snapshot);
	const metadata = sanitizeTaskMetadata(snapshot.metadataJson);
	const contextScore = incomingUserText ? basicSemanticSimilarity(referenceText, incomingUserText) : 0;
	const signalScore = signalConsistencyScore({
		project: metadata.project,
		currentTask: metadata.currentTask,
		nextAction: metadata.nextAction,
		blocker: metadata.blocker
	}, incomingSignals);
	const idleTimeoutHours = Math.max(.25, ctx.config.advanced.taskIdleTimeoutMinutes / 60);
	const age = ageHours(snapshot.updatedAt, ctx.now);
	const idleExpired = snapshot.isActive && age > idleTimeoutHours;
	const exactProjectMatch = metadata.project && incomingSignals.project ? scoreSignalMatch(metadata.project, incomingSignals.project) ?? 0 : 0;
	const exactTaskMatch = metadata.currentTask && incomingSignals.currentTask ? scoreSignalMatch(metadata.currentTask, incomingSignals.currentTask) ?? 0 : 0;
	const projectTextMatch = metadata.project && incomingUserText ? basicSemanticSimilarity(metadata.project, incomingUserText) : 0;
	const taskTextMatch = metadata.currentTask && incomingUserText ? basicSemanticSimilarity(metadata.currentTask, incomingUserText) : 0;
	const softContextScore = incomingSignals.project || incomingSignals.currentTask || incomingSignals.nextAction || incomingSignals.blocker ? Math.min(.5, contextScore) : Math.min(.44, contextScore * .82);
	let continuity = Math.max(signalScore ?? 0, softContextScore);
	if (exactProjectMatch >= .82) continuity = Math.max(continuity, .84);
	if (exactTaskMatch >= .8) continuity = Math.max(continuity, .88);
	if (projectTextMatch >= .7) continuity = Math.max(continuity, .78);
	if (taskTextMatch >= .68) continuity = Math.max(continuity, .82);
	if (snapshot.isActive && !idleExpired) continuity = Math.max(continuity, incomingSignals.project || incomingSignals.currentTask ? .42 : .34);
	continuity = clamp01(continuity);
	return {
		snapshot,
		continuityScore: continuity,
		signalScore: signalScore ?? 0,
		contextScore,
		idleExpired
	};
}
function chooseHeuristicAssignment(activeSnapshot, candidateSnapshots, incomingUserText, incomingSignals, ctx) {
	if (hasExplicitTaskBoundaryCue(incomingUserText)) return {
		decision: "new",
		confidence: .82,
		reason: "boundary gate: the new turn explicitly switches to a different task"
	};
	const evaluated = candidateSnapshots.map((snapshot) => continuityScore(snapshot, incomingUserText, incomingSignals, ctx)).sort((left, right) => right.continuityScore - left.continuityScore);
	const activeScore = activeSnapshot ? evaluated.find((entry) => entry.snapshot.taskId === activeSnapshot.taskId) : void 0;
	const bestOther = evaluated.find((entry) => !entry.snapshot.isActive);
	if (activeScore && !activeScore.idleExpired && activeScore.continuityScore >= .5 && activeScore.continuityScore >= (bestOther?.continuityScore ?? 0) - .04) return {
		decision: "continue",
		confidence: Math.min(.9, Math.max(.56, activeScore.continuityScore)),
		reason: "continuity gate: active task retains enough validated continuity"
	};
	if (bestOther && bestOther.continuityScore >= .72 && bestOther.continuityScore >= (activeScore?.continuityScore ?? 0) + .12) return {
		decision: "resume",
		targetTaskId: bestOther.snapshot.taskId,
		confidence: Math.min(.9, Math.max(.58, bestOther.continuityScore)),
		reason: "continuity gate: a recent task has stronger validated continuity"
	};
	if (activeScore && !activeScore.idleExpired && (incomingSignals.project || incomingSignals.currentTask || activeScore.continuityScore >= .36)) return {
		decision: "continue",
		confidence: Math.min(.82, Math.max(.5, activeScore.continuityScore)),
		reason: "continuity gate: preserve the active task unless a clearer boundary appears"
	};
	return {
		decision: "new",
		confidence: bestOther ? Math.max(.54, 1 - bestOther.continuityScore * .55) : .62,
		reason: "continuity gate: no task passed the conservative continuity checks"
	};
}
function shouldForceHeuristicTaskAssignment(ctx) {
	return ctx.channelId === "longmemeval" && ctx.runId?.startsWith("lme-replay:") === true;
}
function buildDeterministicTaskProposal(params) {
	const decisionNow = effectiveDecisionNow(params.newMessages, params.ctx.now);
	const decisionCtx = decisionNow === params.ctx.now ? params.ctx : {
		...params.ctx,
		now: decisionNow
	};
	const incomingUserText = buildIncomingUserText(params.newMessages);
	const incomingSignals = extractSignalsFromMessages(params.newMessages);
	const dedupedRecent = params.recentTasks.filter((task, index, array) => task.taskId !== params.activeTask?.taskId && array.findIndex((candidate) => candidate.taskId === task.taskId) === index);
	const activeSnapshot = params.activeTask ? buildTaskSnapshot(params.activeTask, params.activeChunks, true) : null;
	const candidateSnapshots = [...activeSnapshot ? [activeSnapshot] : [], ...dedupedRecent.map((task) => buildTaskSnapshot(task, params.recentChunksByTask[task.taskId] ?? [], false))];
	if (!params.activeTask && candidateSnapshots.length === 0) return {
		decision: "new",
		confidence: .98,
		reason: "no active or recent task is available"
	};
	if (!incomingUserText.trim()) return params.activeTask ? {
		decision: "continue",
		confidence: .74,
		reason: "no new user intent was captured, so keep the active task"
	} : {
		decision: "new",
		confidence: .7,
		reason: "no user message was captured, so start a fresh task boundary"
	};
	const heuristicDecision = chooseHeuristicAssignment(activeSnapshot, candidateSnapshots, incomingUserText, incomingSignals, decisionCtx);
	return {
		decision: heuristicDecision.decision,
		targetTaskId: heuristicDecision.targetTaskId,
		confidence: heuristicDecision.confidence,
		reason: heuristicDecision.reason
	};
}
async function decideTaskAssignment(params) {
	const heuristicDecision = buildDeterministicTaskProposal(params);
	if (shouldForceHeuristicTaskAssignment(params.ctx)) return heuristicDecision;
	if (params.taskProposal && params.taskProposal.decision !== "none") {
		if (params.taskProposal.decision === "continue" && !params.activeTask) return heuristicDecision;
		if (params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId && ![params.activeTask?.taskId, ...params.recentTasks.map((task) => task.taskId)].includes(params.taskProposal.targetTaskId)) return heuristicDecision;
		return {
			decision: params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId === params.activeTask?.taskId ? "continue" : params.taskProposal.decision,
			targetTaskId: params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId === params.activeTask?.taskId ? void 0 : params.taskProposal.targetTaskId,
			confidence: params.taskProposal.confidence,
			reason: params.taskProposal.reason ?? "turn-semantic-compiler proposal"
		};
	}
	return heuristicDecision;
}
//#endregion
export { buildDeterministicTaskProposal, decideTaskAssignment };
