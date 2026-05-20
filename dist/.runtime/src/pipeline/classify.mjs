//#region src/pipeline/classify.ts
function classifyAction(action) {
	switch (action) {
		case "session_state":
		case "durable_state": return "current-state";
		case "stable_fact": return "stable-fact";
		case "episodic_event": return "episodic-event";
		case "graph_relation": return "graph-worthy";
		default: return "ignore";
	}
}
//#endregion
export { classifyAction };
