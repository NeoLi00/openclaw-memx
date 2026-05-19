import { handleMcpRequest } from "./mcpProtocol.mjs";
//#region src/host/mcpStdio.ts
async function startMcpStdio() {
	process.stdin.setEncoding("utf8");
	let buffer = "";
	for await (const chunk of process.stdin) {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line) handleLine(line);
			newline = buffer.indexOf("\n");
		}
	}
}
async function handleLine(line) {
	try {
		const response = await handleMcpRequest(JSON.parse(line));
		process.stdout.write(`${JSON.stringify(response)}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32700,
				message: error instanceof Error ? error.message : String(error)
			}
		})}\n`);
	}
}
//#endregion
export { startMcpStdio };
