import { truncateText } from "../support.mjs";
//#region src/host/hookPayload.ts
function readString(record, keys) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
}
function normalizeHostId(hostId) {
	const normalized = hostId.toLowerCase().replace(/_/g, "-");
	if (normalized === "codex" || normalized === "claude-code" || normalized === "openclaw") return normalized;
	return "generic";
}
function compactJson(value, maxChars = 1800) {
	if (typeof value === "string") return truncateText(value, maxChars);
	try {
		return truncateText(JSON.stringify(value), maxChars);
	} catch {
		return truncateText(String(value), maxChars);
	}
}
function hookToolName(payload) {
	return readString(payload, [
		"tool_name",
		"toolName",
		"name",
		"matcher"
	]);
}
function hookToolMessage(eventName, payload) {
	const toolName = hookToolName(payload) ?? eventName;
	return {
		role: "tool",
		toolName,
		content: [
			`hook=${eventName}`,
			`tool=${toolName}`,
			payload.tool_input !== void 0 ? `input=${compactJson(payload.tool_input)}` : "",
			payload.tool_response !== void 0 ? `response=${compactJson(payload.tool_response)}` : "",
			payload.error !== void 0 ? `error=${compactJson(payload.error)}` : ""
		].filter(Boolean).join("\n")
	};
}
function canCaptureToolEvents() {
	return process.env["MEMX_CAPTURE_TOOL_EVENTS"] === "1";
}
function messagesFromHook(eventName, payload) {
	const prompt = readString(payload, [
		"prompt",
		"user_prompt",
		"userPrompt"
	]);
	if (eventName === "UserPromptSubmit" && prompt) return [{
		role: "user",
		content: prompt
	}];
	const assistant = readString(payload, [
		"assistant_response",
		"assistantResponse",
		"response"
	]);
	if (eventName === "Stop" && assistant) return [{
		role: "assistant",
		content: assistant
	}];
	if (eventName === "PreToolUse" || eventName === "PostToolUse" || eventName === "PostToolUseFailure" || eventName === "PreCompact" || eventName === "PostCompact" || eventName === "SubagentStart" || eventName === "SubagentStop" || eventName === "Notification" || eventName === "TaskCompleted" || eventName === "SessionStart" || eventName === "SessionEnd") return canCaptureToolEvents() ? [hookToolMessage(eventName, payload)] : [];
	if (prompt) return [{
		role: "user",
		content: prompt
	}];
	return canCaptureToolEvents() ? [hookToolMessage(eventName, payload)] : [];
}
function normalizeHookPayload(hostId, eventName, payload) {
	const normalizedHost = normalizeHostId(hostId);
	const sessionId = readString(payload, [
		"session_id",
		"sessionId",
		"conversation_id",
		"conversationId"
	]) ?? `${normalizedHost}-default`;
	const workspaceDir = readString(payload, [
		"cwd",
		"workspaceDir",
		"workspace_dir",
		"project_dir"
	]) ?? process.cwd();
	const actorId = readString(payload, [
		"actor_id",
		"actorId",
		"agent_id",
		"agentId"
	]) ?? process.env["MEMX_ACTOR_ID"] ?? "memx-shared";
	const observedAt = readString(payload, ["timestamp", "observedAt"]) ?? (/* @__PURE__ */ new Date()).toISOString();
	return {
		hostId: normalizedHost,
		actorId,
		sessionId,
		workspaceDir,
		project: readString(payload, ["project", "projectName"]),
		runId: readString(payload, ["run_id", "runId"]),
		eventName,
		observedAt,
		messages: messagesFromHook(eventName, payload),
		metadata: {
			rawHookEvent: eventName,
			transcriptPath: readString(payload, ["transcript_path", "transcriptPath"])
		}
	};
}
function normalizeObservePayload(input) {
	if (!input || typeof input !== "object") throw new Error("observe payload must be an object");
	const record = input;
	if (Array.isArray(record.messages)) return {
		hostId: normalizeHostId(readString(record, ["hostId", "host"]) ?? "generic"),
		actorId: readString(record, ["actorId", "agentId"]) ?? "memx-shared",
		sessionId: readString(record, ["sessionId", "sessionKey"]) ?? "generic-default",
		workspaceDir: readString(record, ["workspaceDir", "cwd"]) ?? process.cwd(),
		project: readString(record, ["project"]),
		runId: readString(record, ["runId"]),
		eventName: readString(record, ["eventName"]) ?? "observe",
		observedAt: readString(record, ["observedAt", "timestamp"]) ?? (/* @__PURE__ */ new Date()).toISOString(),
		messages: record.messages.filter((message) => Boolean(message && typeof message === "object")).map((message) => ({
			role: message.role === "assistant" || message.role === "tool" || message.role === "user" ? message.role : "user",
			content: readString(message, ["content", "text"]) ?? "",
			toolName: readString(message, ["toolName", "name"])
		})).filter((message) => message.content.trim().length > 0),
		metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : void 0
	};
	return normalizeHookPayload(readString(record, ["hostId", "host"]) ?? "generic", readString(record, ["eventName", "hookType"]) ?? "observe", record);
}
//#endregion
export { normalizeHookPayload, normalizeObservePayload };
