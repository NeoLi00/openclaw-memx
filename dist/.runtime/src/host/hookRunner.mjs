import { normalizeHookPayload } from "./hookPayload.mjs";
import { MEMX_NATIVE_HOOK_TIMEOUT_MS, deriveNativeHookHttpTimeoutMs, deriveNativeHookQueryCompilerTimeoutMs } from "../timeouts.mjs";
import { completeEnvelopeFromTranscript } from "./transcript.mjs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
//#region src/host/hookRunner.ts
const DEFAULT_URL = "http://127.0.0.1:3878";
const CONTEXT_INJECTION_EVENTS = new Set(["UserPromptSubmit"]);
async function readStdinJson() {
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	if (!input.trim()) return {};
	return JSON.parse(input);
}
function authHeaders() {
	const secret = process.env["MEMX_SECRET"];
	return secret ? { authorization: `Bearer ${secret}` } : {};
}
async function post(path, body, timeoutMs) {
	const url = (process.env["MEMX_URL"] || DEFAULT_URL).replace(/\/+$/u, "");
	const response = await fetch(`${url}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...authHeaders()
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!response.ok) throw new Error(`${path} -> ${response.status} ${response.statusText}`);
	const text = await response.text();
	return text ? JSON.parse(text) : null;
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hookCanInjectContext(host, eventName) {
	return (host === "codex" || host === "claude-code") && CONTEXT_INJECTION_EVENTS.has(eventName);
}
function hookShouldStorePending(eventName) {
	return eventName === "UserPromptSubmit";
}
function hookShouldFlushPending(eventName) {
	return eventName === "Stop" || eventName === "SessionEnd";
}
function userQueryFromEnvelope(envelope) {
	return envelope.messages.find((message) => message.role === "user" && message.content.trim())?.content.trim() || null;
}
function contextRequestFromEnvelope(envelope, hotPathTimeoutMs) {
	const query = userQueryFromEnvelope(envelope);
	if (!query) return null;
	return {
		query,
		hostId: envelope.hostId,
		actorId: envelope.actorId,
		sessionId: envelope.sessionId,
		workspaceDir: envelope.workspaceDir,
		project: envelope.project,
		limit: 6,
		hotPathTimeoutMs
	};
}
function recalledContext(response) {
	if (!isRecord(response)) return null;
	const value = response.prependContext ?? response.context;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
function writeAdditionalContext(eventName, additionalContext) {
	process.stdout.write(`${JSON.stringify({ hookSpecificOutput: {
		hookEventName: eventName,
		additionalContext
	} })}\n`);
}
function parsePositiveInt(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function pendingRoot() {
	return process.env["MEMX_PENDING_DIR"]?.trim() || join(homedir(), ".memx", "pending-hooks");
}
function pendingKey(envelope) {
	return createHash("sha256").update(JSON.stringify([
		envelope.hostId,
		envelope.actorId,
		envelope.sessionId,
		envelope.workspaceDir ?? ""
	])).digest("hex");
}
function pendingPath(envelope) {
	return join(pendingRoot(), `${pendingKey(envelope)}.json`);
}
async function writePendingTurn(envelope) {
	if (envelope.messages.length === 0) return;
	const path = pendingPath(envelope);
	await mkdir(pendingRoot(), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, `${JSON.stringify(envelope)}\n`, "utf8");
	await rename(tmp, path);
}
async function readPendingTurn(envelope) {
	try {
		const parsed = JSON.parse(await readFile(pendingPath(envelope), "utf8"));
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) return null;
		return parsed;
	} catch {
		return null;
	}
}
async function clearPendingTurn(envelope) {
	await rm(pendingPath(envelope), { force: true });
}
function mergePendingTurn(current, pending) {
	const pendingMessages = pending?.messages ?? [];
	return {
		...current,
		eventName: pending ? "turn" : current.eventName,
		observedAt: current.observedAt,
		messages: [...pendingMessages, ...current.messages],
		metadata: {
			...pending?.metadata ?? {},
			...current.metadata ?? {},
			pendingHookEvent: pending?.eventName,
			rawHookEvent: current.eventName
		}
	};
}
function hasAssistantMessage(envelope) {
	return envelope.messages.some((message) => message.role === "assistant" && message.content.trim().length > 0);
}
function debug(message) {
	if (process.env["MEMX_HOOK_DEBUG"] === "1") console.error(message);
}
async function runMemxHook(argv = process.argv.slice(2)) {
	const host = argv[0] || process.env["MEMX_HOOK_HOST"] || "generic";
	const eventName = argv[1] || process.env["MEMX_HOOK_EVENT"] || "observe";
	const payload = await readStdinJson();
	const timeoutMs = parsePositiveInt(process.env["MEMX_HOOK_TIMEOUT_MS"], MEMX_NATIVE_HOOK_TIMEOUT_MS);
	const contextTimeoutMs = parsePositiveInt(process.env["MEMX_HOOK_CONTEXT_TIMEOUT_MS"], deriveNativeHookHttpTimeoutMs(timeoutMs));
	const observeTimeoutMs = parsePositiveInt(process.env["MEMX_HOOK_OBSERVE_TIMEOUT_MS"], deriveNativeHookHttpTimeoutMs(timeoutMs));
	const queryCompilerTimeoutMs = deriveNativeHookQueryCompilerTimeoutMs(contextTimeoutMs);
	try {
		const envelope = normalizeHookPayload(host, eventName, payload);
		if (hookShouldStorePending(eventName)) await writePendingTurn(envelope);
		const contextRequest = hookCanInjectContext(envelope.hostId, eventName) ? contextRequestFromEnvelope(envelope, queryCompilerTimeoutMs) : null;
		if (contextRequest) {
			const contextResult = await Promise.resolve().then(() => post("/v1/context", contextRequest, contextTimeoutMs)).then((value) => ({
				status: "fulfilled",
				value
			}), (reason) => ({
				status: "rejected",
				reason
			}));
			if (contextResult.status === "fulfilled") {
				const context = recalledContext(contextResult.value);
				if (context) writeAdditionalContext(eventName, context);
			} else debug(`memx hook recall failed: ${contextResult.reason instanceof Error ? contextResult.reason.message : String(contextResult.reason)}`);
		}
		if (hookShouldStorePending(eventName)) return;
		const shouldFlushPending = hookShouldFlushPending(eventName);
		const pending = shouldFlushPending ? await readPendingTurn(envelope) : null;
		if (eventName === "SessionEnd" && !pending) {
			debug("memx hook observe skipped: SessionEnd has no pending user turn");
			return;
		}
		const completedEnvelope = shouldFlushPending ? await completeEnvelopeFromTranscript(envelope, pending) : envelope;
		const observeEnvelope = shouldFlushPending ? mergePendingTurn(completedEnvelope, pending) : completedEnvelope;
		if (shouldFlushPending && pending && !hasAssistantMessage(observeEnvelope)) {
			debug("memx hook observe deferred: assistant output is not available yet");
			return;
		}
		if (observeEnvelope.messages.length === 0) return;
		const observeResult = await Promise.resolve().then(() => post("/v1/observe", observeEnvelope, observeTimeoutMs)).then(() => ({ status: "fulfilled" }), (reason) => ({
			status: "rejected",
			reason
		}));
		if (observeResult.status === "fulfilled" && shouldFlushPending) await clearPendingTurn(envelope);
		if (observeResult.status === "rejected") debug(`memx hook observe failed: ${observeResult.reason instanceof Error ? observeResult.reason.message : String(observeResult.reason)}`);
	} catch (error) {
		debug(`memx hook failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
//#endregion
export { runMemxHook };
