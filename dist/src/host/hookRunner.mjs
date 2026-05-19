import { normalizeHookPayload } from "./hookPayload.mjs";
//#region src/host/hookRunner.ts
const DEFAULT_URL = "http://localhost:3878";
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
async function runMemxHook(argv = process.argv.slice(2)) {
	const host = argv[0] || process.env["MEMX_HOOK_HOST"] || "generic";
	const eventName = argv[1] || process.env["MEMX_HOOK_EVENT"] || "observe";
	const payload = await readStdinJson();
	const timeoutMs = Number(process.env["MEMX_HOOK_TIMEOUT_MS"] || 3e3);
	try {
		await post("/v1/observe", normalizeHookPayload(host, eventName, payload), Number.isFinite(timeoutMs) ? timeoutMs : 3e3);
	} catch (error) {
		if (process.env["MEMX_HOOK_DEBUG"] === "1") console.error(`memory-memx hook failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
//#endregion
export { runMemxHook };
