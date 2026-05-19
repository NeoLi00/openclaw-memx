import { applyClaudeJsonConnect, applyCodexTomlConnect, buildGenericMcpConfig } from "./connect.mjs";
import { DEFAULT_MEMORY_CONFIG } from "../config.mjs";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
//#region src/host/standaloneQuickstart.ts
const DEFAULT_CONFIG_PATH = join(homedir(), ".memx", "config.json");
const DEFAULT_DB_PATH = join(homedir(), ".memx", "{agentId}", "memx.sqlite");
const DEFAULT_MEMX_URL = "http://localhost:3878";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
function trimOrUndefined(value) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : void 0;
}
function localVenvDir(homeDir) {
	return join(homeDir, ".memx", ".venv");
}
function localVenvPython(homeDir) {
	const venv = localVenvDir(homeDir);
	return platform() === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}
function normalizeEmbeddingProvider(provider) {
	if (!provider || provider === "local") return "sentence-transformers-local";
	return provider;
}
function secretValue(value, envName) {
	const direct = trimOrUndefined(value);
	const env = trimOrUndefined(envName);
	if (direct && env) throw new Error("use either a direct API key or an API key env var, not both");
	if (env) return `\${${env}}`;
	return direct;
}
function normalizeOptions(options) {
	const llmProvider = options.llmProvider ?? "openai-compatible";
	const llmBaseUrl = trimOrUndefined(options.llmBaseUrl);
	const llmModel = trimOrUndefined(options.llmModel);
	if (!llmBaseUrl) throw new Error("standalone quickstart requires --llm-base-url");
	if (!llmModel) throw new Error("standalone quickstart requires --llm-model");
	const homeDir = options.homeDir ?? homedir();
	const embeddingProvider = normalizeEmbeddingProvider(options.embeddingProvider);
	return {
		...options,
		target: options.target,
		llmProvider,
		llmBaseUrl,
		llmModel,
		embeddingProvider,
		embeddingModel: trimOrUndefined(options.embeddingModel) ?? DEFAULT_EMBEDDING_MODEL,
		embeddingPythonBin: trimOrUndefined(options.embeddingPythonBin) ?? (embeddingProvider === "sentence-transformers-local" ? localVenvPython(homeDir) : ""),
		configPath: trimOrUndefined(options.configPath) ?? DEFAULT_CONFIG_PATH,
		homeDir,
		pythonBin: trimOrUndefined(options.pythonBin) ?? "python3",
		memxUrl: trimOrUndefined(options.memxUrl) ?? DEFAULT_MEMX_URL
	};
}
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function deepMerge(base, override) {
	if (!isRecord(base) || !isRecord(override)) return override === void 0 ? base : override;
	const output = { ...base };
	for (const [key, value] of Object.entries(override)) output[key] = key in output ? deepMerge(output[key], value) : value;
	return output;
}
function baseStandaloneConfig() {
	const config = structuredClone(DEFAULT_MEMORY_CONFIG);
	config.dbPath = DEFAULT_DB_PATH;
	config.defaultScope = "agent:{agentId}";
	config.allowedScopes = [
		"global",
		"agent:{agentId}",
		"session:{sessionKey}",
		"project:{project}"
	];
	config.advanced.llmClassifierEnabled = true;
	config.advanced.enableTurnScheduler = true;
	config.advanced.enableCompatibilityMemoryTools = false;
	return config;
}
function applyStandaloneMemxQuickstartConfig(input, rawOptions) {
	const options = normalizeOptions(rawOptions);
	const next = deepMerge(baseStandaloneConfig(), input);
	next.advanced.llmProvider = options.llmProvider;
	next.advanced.llmBaseURL = options.llmBaseUrl;
	next.advanced.llmClassifierModel = options.llmModel;
	next.advanced.llmApiKey = secretValue(options.llmApiKey, options.llmApiKeyEnv);
	next.embedding.provider = options.embeddingProvider;
	next.embedding.model = options.embeddingModel;
	if (options.embeddingProvider === "openai-compatible") {
		next.embedding.baseURL = trimOrUndefined(options.embeddingBaseUrl);
		next.embedding.apiKey = secretValue(options.embeddingApiKey, options.embeddingApiKeyEnv);
	}
	if (options.embeddingProvider === "ollama") next.embedding.ollamaBaseURL = trimOrUndefined(options.embeddingOllamaBaseUrl);
	if (options.embeddingProvider === "sentence-transformers-local") {
		next.embedding.localPythonBin = options.embeddingPythonBin;
		next.embedding.localDevice = options.embeddingDevice ?? "auto";
		if (trimOrUndefined(options.embeddingCacheDir)) next.embedding.localCacheDir = trimOrUndefined(options.embeddingCacheDir);
	}
	return next;
}
function buildStandaloneMemxQuickstartSteps(rawOptions) {
	const options = normalizeOptions(rawOptions);
	if (options.embeddingProvider !== "sentence-transformers-local" || options.skipEmbeddingDeps) return [];
	return [{
		key: "embedding-venv",
		command: options.pythonBin,
		args: [
			"-m",
			"venv",
			localVenvDir(options.homeDir)
		]
	}, {
		key: "embedding-deps",
		command: options.embeddingPythonBin,
		args: [
			"-m",
			"pip",
			"install",
			"-U",
			"pip",
			"sentence-transformers",
			"torch"
		]
	}];
}
async function readJson(path) {
	if (!existsSync(path)) return {};
	return JSON.parse(await readFile(path, "utf8"));
}
async function writeAtomic(path, text) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, text, "utf8");
	await rename(tmp, path);
}
async function defaultRunCommand(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			shell: false,
			stdio: "inherit"
		});
		child.once("error", reject);
		child.once("close", (code) => resolve({ code: code ?? 1 }));
	});
}
async function writeHostConfig(options) {
	if (options.target === "codex") {
		const path = trimOrUndefined(options.codexConfigPath) ?? join(options.homeDir, ".codex", "config.toml");
		await writeAtomic(path, applyCodexTomlConnect(existsSync(path) ? await readFile(path, "utf8") : "", options.memxUrl, options.memxSecret ?? ""));
		return {
			host: "codex",
			path
		};
	}
	if (options.target === "claude-code") {
		const path = trimOrUndefined(options.claudeConfigPath) ?? join(options.homeDir, ".claude.json");
		const next = applyClaudeJsonConnect(await readJson(path), options.memxUrl, options.memxSecret ?? "");
		await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
		return {
			host: "claude-code",
			path
		};
	}
	return null;
}
function redactSummary(options, steps) {
	return {
		target: options.target,
		configPath: options.configPath,
		llmProvider: options.llmProvider,
		llmBaseUrl: options.llmBaseUrl,
		llmModel: options.llmModel,
		llmApiKey: options.llmApiKeyEnv ? {
			source: "env",
			id: options.llmApiKeyEnv
		} : "plaintext-redacted",
		embeddingProvider: options.embeddingProvider,
		embeddingModel: options.embeddingModel,
		embeddingPythonBin: options.embeddingPythonBin || null,
		memxUrl: options.memxUrl,
		steps,
		mcpConfig: options.target === "mcp" ? buildGenericMcpConfig(options.memxUrl, options.memxSecret ?? "") : void 0
	};
}
async function runStandaloneMemxQuickstart(rawOptions, deps = {}) {
	const options = normalizeOptions(rawOptions);
	const next = applyStandaloneMemxQuickstartConfig(await readJson(options.configPath), options);
	const steps = buildStandaloneMemxQuickstartSteps(options);
	let hostConfig = null;
	if (!options.dryRun) {
		await writeAtomic(options.configPath, `${JSON.stringify(next, null, 2)}\n`);
		hostConfig = await writeHostConfig(options);
		const runCommand = deps.runCommand ?? defaultRunCommand;
		for (const step of steps) {
			const result = await runCommand(step.command, step.args);
			if (result.code !== 0) throw new Error(`standalone quickstart step failed: ${step.key} (${step.command} ${step.args.join(" ")}) exited ${result.code}`);
		}
	}
	return {
		ok: true,
		dryRun: Boolean(options.dryRun),
		...redactSummary(options, steps),
		hostConfig,
		nextStep: "Start memx-server with this config, then use the configured MCP client or native plugin."
	};
}
//#endregion
export { applyStandaloneMemxQuickstartConfig, buildStandaloneMemxQuickstartSteps, runStandaloneMemxQuickstart };
