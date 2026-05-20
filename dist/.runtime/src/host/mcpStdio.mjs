import { handleMcpRequest } from "./mcpProtocol.mjs";
//#region src/host/mcpStdio.ts
async function startMcpStdio() {
	let buffer = Buffer.alloc(0);
	for await (const chunk of process.stdin) {
		buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
		while (true) {
			const decoded = readMessage(buffer);
			if (!decoded) break;
			buffer = decoded.remaining;
			handleMessage(decoded.message);
		}
	}
	const leftover = buffer.toString("utf8").trim();
	if (leftover) handleMessage({
		payload: leftover,
		framed: false
	});
}
function findHeaderEnd(buffer) {
	const crlf = buffer.indexOf("\r\n\r\n");
	if (crlf >= 0) return {
		index: crlf,
		length: 4
	};
	const lf = buffer.indexOf("\n\n");
	return lf >= 0 ? {
		index: lf,
		length: 2
	} : null;
}
function readMessage(buffer) {
	if (buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii").toLowerCase().startsWith("content-length:")) {
		const headerEnd = findHeaderEnd(buffer);
		if (!headerEnd) return null;
		const lengthHeader = buffer.subarray(0, headerEnd.index).toString("ascii").split(/\r?\n/u).find((line) => line.toLowerCase().startsWith("content-length:"));
		const length = Number(lengthHeader?.slice(15).trim());
		if (!Number.isInteger(length) || length < 0) return {
			message: {
				error: "invalid Content-Length header",
				framed: true
			},
			remaining: buffer.subarray(headerEnd.index + headerEnd.length)
		};
		const bodyStart = headerEnd.index + headerEnd.length;
		const bodyEnd = bodyStart + length;
		if (buffer.length < bodyEnd) return null;
		return {
			message: {
				payload: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
				framed: true
			},
			remaining: buffer.subarray(bodyEnd)
		};
	}
	const newline = buffer.indexOf("\n");
	if (newline < 0) return null;
	return {
		message: {
			payload: buffer.subarray(0, newline).toString("utf8").trim(),
			framed: false
		},
		remaining: buffer.subarray(newline + 1)
	};
}
function writeResponse(response, framed) {
	const json = JSON.stringify(response);
	if (framed) {
		process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
		return;
	}
	process.stdout.write(`${json}\n`);
}
async function handleMessage(message) {
	if ("error" in message) {
		writeResponse({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32700,
				message: message.error
			}
		}, message.framed);
		return;
	}
	await handlePayload(message);
}
async function handlePayload(message) {
	if (!message.payload.trim()) return;
	try {
		const response = await handleMcpRequest(JSON.parse(message.payload));
		if (response) writeResponse(response, message.framed);
	} catch (error) {
		writeResponse({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32700,
				message: error instanceof Error ? error.message : String(error)
			}
		}, message.framed);
	}
}
//#endregion
export { startMcpStdio };
