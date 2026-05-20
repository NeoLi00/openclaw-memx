//#region src/pipeline/agentEndMessages.ts
function isTurnScopedAgentEndPayload(ctx) {
	return ctx.trigger === "memory" && ctx.messageProvider === "gateway";
}
function initializeSnapshotCursor(messages) {
	const roles = messages.filter((message) => Boolean(message) && typeof message === "object").map((message) => message.role).filter((role) => typeof role === "string");
	if (roles.length > 0 && roles.every((role) => role === "user")) return 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message && typeof message === "object" && message.role === "user") return index;
	}
	return messages.length;
}
function selectAgentEndMessagesForCapture(params) {
	if (isTurnScopedAgentEndPayload(params.ctx)) return params.messages;
	let cursor = params.cursors.getSessionCursor(params.agentId, params.sessionKey);
	if (cursor === void 0) cursor = initializeSnapshotCursor(params.messages);
	if (cursor > params.messages.length) cursor = 0;
	params.cursors.setSessionCursor(params.agentId, params.sessionKey, params.messages.length);
	if (cursor >= params.messages.length) return [];
	return params.messages.slice(cursor);
}
//#endregion
export { selectAgentEndMessagesForCapture };
