#!/usr/bin/env node
//#region src/bin/memx.ts
function usage() {
	return [
		"Usage: memx <command>",
		"",
		"Commands:",
		"  server              Start the local memX REST service",
		"  mcp                 Start the memX MCP stdio server",
		"  hook <host> <event>  Run a native hook bridge",
		"  quickstart openclaw Configure OpenClaw-only quickstart settings",
		"  quickstart codex    Configure standalone memX for Codex",
		"  quickstart claude-code Configure standalone memX for Claude Code",
		"  quickstart mcp      Configure standalone memX and print generic MCP JSON",
		"  connect codex       Wire Codex MCP config",
		"  connect claude-code Wire Claude Code MCP config"
	].join("\n");
}
function readOption(argv, name) {
	const index = argv.indexOf(name);
	if (index < 0) return;
	return argv[index + 1];
}
function hasFlag(argv, name) {
	return argv.includes(name);
}
function parseOpenClawQuickstartOptions(argv) {
	const embeddingProvider = readOption(argv, "--embedding-provider");
	return {
		llmProvider: readOption(argv, "--llm-provider"),
		llmBaseUrl: readOption(argv, "--llm-base-url"),
		llmModel: readOption(argv, "--llm-model"),
		llmApiKey: readOption(argv, "--llm-api-key"),
		llmApiKeyEnv: readOption(argv, "--llm-api-key-env"),
		providerId: readOption(argv, "--provider-id"),
		baseUrl: readOption(argv, "--base-url"),
		apiKey: readOption(argv, "--api-key"),
		apiKeyEnv: readOption(argv, "--api-key-env"),
		agentModel: readOption(argv, "--agent-model"),
		memxModel: readOption(argv, "--memx-model"),
		embeddingProvider,
		embeddingModel: readOption(argv, "--embedding-model"),
		embeddingPythonBin: readOption(argv, "--embedding-python"),
		embeddingCacheDir: readOption(argv, "--embedding-cache-dir"),
		embeddingDevice: readOption(argv, "--embedding-device"),
		configPath: readOption(argv, "--config"),
		openclawBin: readOption(argv, "--openclaw-bin"),
		pythonBin: readOption(argv, "--python"),
		skipEmbeddingDeps: hasFlag(argv, "--skip-embedding-deps") || hasFlag(argv, "--no-install-embedding-deps"),
		skipPluginInstall: hasFlag(argv, "--skip-plugin-install"),
		skipRestart: hasFlag(argv, "--skip-restart"),
		skipDoctor: hasFlag(argv, "--skip-doctor"),
		dryRun: hasFlag(argv, "--dry-run")
	};
}
function parseStandaloneQuickstartOptions(target, argv) {
	const embeddingProvider = readOption(argv, "--embedding-provider");
	return {
		target,
		llmProvider: readOption(argv, "--llm-provider"),
		llmBaseUrl: readOption(argv, "--llm-base-url"),
		llmModel: readOption(argv, "--llm-model"),
		llmApiKey: readOption(argv, "--llm-api-key"),
		llmApiKeyEnv: readOption(argv, "--llm-api-key-env"),
		embeddingProvider,
		embeddingModel: readOption(argv, "--embedding-model"),
		embeddingBaseUrl: readOption(argv, "--embedding-base-url"),
		embeddingApiKey: readOption(argv, "--embedding-api-key"),
		embeddingApiKeyEnv: readOption(argv, "--embedding-api-key-env"),
		embeddingPythonBin: readOption(argv, "--embedding-python"),
		embeddingCacheDir: readOption(argv, "--embedding-cache-dir"),
		embeddingDevice: readOption(argv, "--embedding-device"),
		embeddingOllamaBaseUrl: readOption(argv, "--embedding-ollama-base-url"),
		configPath: readOption(argv, "--config"),
		codexConfigPath: readOption(argv, "--codex-config"),
		claudeConfigPath: readOption(argv, "--claude-config"),
		homeDir: readOption(argv, "--home"),
		pythonBin: readOption(argv, "--python"),
		memxUrl: readOption(argv, "--memx-url"),
		memxSecret: readOption(argv, "--memx-secret"),
		skipEmbeddingDeps: hasFlag(argv, "--skip-embedding-deps") || hasFlag(argv, "--no-install-embedding-deps"),
		dryRun: hasFlag(argv, "--dry-run")
	};
}
async function main(argv = process.argv.slice(2)) {
	const command = argv[0];
	if (!command || command === "--help" || command === "-h") {
		console.log(usage());
		return;
	}
	if (command === "server") {
		const { startMemxHttpServer } = await import("../host/httpServer.mjs");
		await startMemxHttpServer();
		return;
	}
	if (command === "mcp") {
		const { startMcpStdio } = await import("../host/mcpStdio.mjs");
		await startMcpStdio();
		return;
	}
	if (command === "hook") {
		const { runMemxHook } = await import("../host/hookRunner.mjs");
		await runMemxHook(argv.slice(1));
		return;
	}
	if (command === "quickstart") {
		const target = argv[1];
		if (target === "openclaw") {
			const { runOpenClawQuickstart } = await import("../host/quickstart.mjs");
			const result = await runOpenClawQuickstart(parseOpenClawQuickstartOptions(argv.slice(2)));
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		if (target === "codex" || target === "claude-code" || target === "mcp") {
			const { runStandaloneMemxQuickstart } = await import("../host/standaloneQuickstart.mjs");
			const result = await runStandaloneMemxQuickstart(parseStandaloneQuickstartOptions(target, argv.slice(2)));
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		throw new Error(`unknown quickstart target: ${target ?? ""}`);
	}
	if (command === "connect") {
		const { connectClaudeCodeConfig, connectCodexConfig } = await import("../host/connect.mjs");
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
