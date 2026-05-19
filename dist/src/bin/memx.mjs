#!/usr/bin/env node
import { connectClaudeCodeConfig, connectCodexConfig } from "../host/connect.mjs";
import { runMemxHook } from "../host/hookRunner.mjs";
import { startMemxHttpServer } from "../host/httpServer.mjs";
import { startMcpStdio } from "../host/mcpStdio.mjs";
//#region src/bin/memx.ts
function usage() {
	return [
		"Usage: memx <command>",
		"",
		"Commands:",
		"  server              Start the local MemX REST service",
		"  mcp                 Start the MemX MCP stdio server",
		"  hook <host> <event>  Run a native hook bridge",
		"  connect codex       Wire Codex MCP config",
		"  connect claude-code Wire Claude Code MCP config"
	].join("\n");
}
async function main(argv = process.argv.slice(2)) {
	const command = argv[0];
	if (!command || command === "--help" || command === "-h") {
		console.log(usage());
		return;
	}
	if (command === "server") {
		await startMemxHttpServer();
		return;
	}
	if (command === "mcp") {
		await startMcpStdio();
		return;
	}
	if (command === "hook") {
		await runMemxHook(argv.slice(1));
		return;
	}
	if (command === "connect") {
		const target = argv[1];
		if (target === "codex") {
			console.log(`Wired Codex: ${connectCodexConfig()}`);
			return;
		}
		if (target === "claude-code" || target === "claude") {
			console.log(`Wired Claude Code: ${connectClaudeCodeConfig()}`);
			return;
		}
		throw new Error(`unknown connect target: ${target ?? ""}`);
	}
	throw new Error(`unknown command: ${command}`);
}
main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
//#endregion
export {};
