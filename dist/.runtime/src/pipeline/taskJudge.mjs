//#region src/pipeline/taskJudge.ts
async function decideTaskAssignment(params) {
	if (params.taskProposal && params.taskProposal.decision !== "none") {
		if (params.taskProposal.decision === "continue" && !params.activeTask) return {
			decision: "new",
			confidence: .52,
			reason: "llm task proposal requested continue without an active task"
		};
		if (params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId && ![params.activeTask?.taskId, ...params.recentTasks.map((task) => task.taskId)].includes(params.taskProposal.targetTaskId)) return params.activeTask ? {
			decision: "continue",
			confidence: .5,
			reason: "llm task proposal referenced an unavailable task"
		} : {
			decision: "new",
			confidence: .5,
			reason: "llm task proposal referenced an unavailable task"
		};
		return {
			decision: params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId === params.activeTask?.taskId ? "continue" : params.taskProposal.decision,
			targetTaskId: params.taskProposal.decision === "resume" && params.taskProposal.targetTaskId === params.activeTask?.taskId ? void 0 : params.taskProposal.targetTaskId,
			confidence: params.taskProposal.confidence,
			reason: params.taskProposal.reason ?? "turn-semantic-compiler proposal"
		};
	}
	return params.activeTask ? {
		decision: "continue",
		confidence: .5,
		reason: "llm-only task assignment defaulted to active task"
	} : {
		decision: "new",
		confidence: .5,
		reason: "llm-only task assignment defaulted to new task"
	};
}
//#endregion
export { decideTaskAssignment };
