import { DEFAULT_MEMORY_CONFIG } from "../config.mjs";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
//#region src/host/quickstart.ts
const PACKAGE_NAME = "@neoli00/memory-memx";
const PLUGIN_ID = "memory-memx";
const DEFAULT_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_AGENT_MODEL = "deepseek-v4-pro";
const DEFAULT_MEMX_MODEL = "deepseek-v4-flash";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
function asConfig(input) {
	return input && typeof input === "object" && !Array.isArray(input) ? structuredClone(input) : {};
}
function trimOrUndefined(value) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : void 0;
}
function localVenvDir(homeDir) {
	return join(homeDir, ".openclaw", "memx", ".venv");
}
function localVenvPython(homeDir) {
	const venv = localVenvDir(homeDir);
	return platform() === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}
function normalizeEmbeddingProvider(provider) {
	if (!provider || provider === "local") return "sentence-transformers-local";
	return provider;
}
function normalizeOptions(options) {
	const preset = options.preset ?? "deepseek";
	const providerId = trimOrUndefined(options.providerId) ?? "deepseek";
	const baseUrl = trimOrUndefined(options.baseUrl) ?? (preset === "deepseek" ? DEFAULT_DEEPSEEK_BASE_URL : void 0);
	if (!baseUrl) throw new Error("baseUrl is required for custom quickstart providers");
	if (options.apiKey && options.apiKeyEnv) throw new Error("use either --api-key or --api-key-env, not both");
	if (!trimOrUndefined(options.apiKey) && !trimOrUndefined(options.apiKeyEnv)) throw new Error("quickstart requires --api-key or --api-key-env");
	const homeDir = options.homeDir ?? homedir();
	const embeddingProvider = normalizeEmbeddingProvider(options.embeddingProvider);
	return {
		...options,
		preset,
		providerId,
		baseUrl,
		agentModel: trimOrUndefined(options.agentModel) ?? DEFAULT_AGENT_MODEL,
		memxModel: trimOrUndefined(options.memxModel) ?? DEFAULT_MEMX_MODEL,
		embeddingProvider,
		embeddingModel: trimOrUndefined(options.embeddingModel) ?? DEFAULT_EMBEDDING_MODEL,
		embeddingPythonBin: trimOrUndefined(options.embeddingPythonBin) ?? (embeddingProvider === "sentence-transformers-local" ? localVenvPython(homeDir) : ""),
		configPath: trimOrUndefined(options.configPath) ?? DEFAULT_CONFIG_PATH,
		homeDir,
		openclawBin: trimOrUndefined(options.openclawBin) ?? "openclaw",
		pythonBin: trimOrUndefined(options.pythonBin) ?? "python3"
	};
}
function apiKeyValue(options) {
	const envName = trimOrUndefined(options.apiKeyEnv);
	if (envName) return {
		source: "env",
		provider: "default",
		id: envName
	};
	const key = trimOrUndefined(options.apiKey);
	if (!key) throw new Error("quickstart requires --api-key or --api-key-env");
	return key;
}
function displayName(model) {
	if (model === DEFAULT_AGENT_MODEL) return "DeepSeek V4 Pro";
	if (model === DEFAULT_MEMX_MODEL) return "DeepSeek V4 Flash";
	return model.split(/[-_:./]+/u).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
function modelEntry(model) {
	return {
		id: model,
		name: displayName(model),
		api: "openai-completions",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0
		},
		contextWindow: 64e3,
		maxTokens: 8192
	};
}
function mergeModels(existing, models) {
	const byId = /* @__PURE__ */ new Map();
	for (const entry of existing ?? []) if (entry?.id) byId.set(entry.id, entry);
	for (const model of models) byId.set(model, {
		...modelEntry(model),
		...byId.get(model) ?? {}
	});
	return [...byId.values()];
}
function modelRef(providerId, model) {
	return `${providerId}/${model}`;
}
function withPrimaryModel(current, primary) {
	const defaults = current && typeof current === "object" ? current : {};
	const currentModel = defaults.model;
	const model = currentModel && typeof currentModel === "object" && !Array.isArray(currentModel) ? {
		...currentModel,
		primary
	} : { primary };
	return {
		...defaults,
		model
	};
}
function withAllowlistModels(defaults, refs) {
	const existing = defaults.models;
	if (!existing || typeof existing !== "object" || Array.isArray(existing)) return defaults;
	const models = { ...existing };
	for (const item of refs) models[item.ref] = {
		...models[item.ref] ?? {},
		alias: item.alias
	};
	return {
		...defaults,
		models
	};
}
function memxEntry(currentEntry, options) {
	const base = structuredClone(DEFAULT_MEMORY_CONFIG);
	const existingConfig = currentEntry?.config && typeof currentEntry.config === "object" ? currentEntry.config : {};
	const existingEmbedding = existingConfig.embedding && typeof existingConfig.embedding === "object" ? existingConfig.embedding : {};
	const existingAdvanced = existingConfig.advanced && typeof existingConfig.advanced === "object" ? existingConfig.advanced : {};
	const embedding = {
		...base.embedding,
		...existingEmbedding,
		provider: options.embeddingProvider,
		model: options.embeddingModel,
		...options.embeddingProvider === "sentence-transformers-local" ? {
			localPythonBin: options.embeddingPythonBin,
			...options.embeddingCacheDir?.trim() ? { localCacheDir: options.embeddingCacheDir.trim() } : {},
			localDevice: options.embeddingDevice ?? base.embedding.localDevice
		} : {}
	};
	return {
		...currentEntry ?? {},
		enabled: true,
		hooks: {
			...currentEntry?.hooks ?? {},
			allowPromptInjection: true
		},
		config: {
			...base,
			...existingConfig,
			embedding,
			advanced: {
				...base.advanced,
				...existingAdvanced,
				enableTurnScheduler: true,
				enableCompatibilityMemoryTools: false,
				llmClassifierEnabled: true,
				llmClassifierModel: modelRef(options.providerId, options.memxModel)
			}
		}
	};
}
function applyOpenClawQuickstartConfig(input, rawOptions) {
	const options = normalizeOptions(rawOptions);
	const next = asConfig(input);
	const agentRef = modelRef(options.providerId, options.agentModel);
	const memxRef = modelRef(options.providerId, options.memxModel);
	const providers = { ...next.models?.providers ?? {} };
	const existingProvider = providers[options.providerId] ?? {};
	providers[options.providerId] = {
		...existingProvider,
		api: "openai-completions",
		baseUrl: options.baseUrl,
		apiKey: apiKeyValue(options),
		models: mergeModels(existingProvider.models, [options.agentModel, options.memxModel])
	};
	const defaults = withAllowlistModels(withPrimaryModel(next.agents?.defaults, agentRef), [{
		ref: agentRef,
		alias: displayName(options.agentModel)
	}, {
		ref: memxRef,
		alias: displayName(options.memxModel)
	}]);
	const allow = new Set(next.plugins?.allow ?? []);
	allow.add(PLUGIN_ID);
	return {
		...next,
		agents: {
			...next.agents ?? {},
			defaults
		},
		models: {
			...next.models ?? {},
			providers
		},
		plugins: {
			...next.plugins ?? {},
			allow: [...allow],
			slots: {
				...next.plugins?.slots ?? {},
				memory: PLUGIN_ID
			},
			entries: {
				...next.plugins?.entries ?? {},
				[PLUGIN_ID]: memxEntry(next.plugins?.entries?.[PLUGIN_ID], options)
			}
		}
	};
}
function buildOpenClawQuickstartSteps(rawOptions) {
	const options = normalizeOptions(rawOptions);
	const steps = [];
	if (options.embeddingProvider === "sentence-transformers-local" && !options.skipEmbeddingDeps) {
		steps.push({
			key: "embedding-venv",
			command: options.pythonBin,
			args: [
				"-m",
				"venv",
				localVenvDir(options.homeDir)
			]
		});
		steps.push({
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
		});
	}
	if (!options.skipPluginInstall) steps.push({
		key: "plugin-install",
		command: options.openclawBin,
		args: [
			"plugins",
			"install",
			PACKAGE_NAME
		]
	});
	if (!options.skipRestart) steps.push({
		key: "gateway-restart",
		command: options.openclawBin,
		args: ["gateway", "restart"]
	});
	if (!options.skipDoctor) steps.push({
		key: "doctor",
		command: options.openclawBin,
		args: [
			"memx",
			"doctor",
			"--deep"
		]
	});
	return steps;
}
async function readConfig(path) {
	if (!existsSync(path)) return {};
	return asConfig(JSON.parse(await readFile(path, "utf8")));
}
async function writeAtomicJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
function publicSummary(options, steps) {
	return {
		preset: options.preset,
		providerId: options.providerId,
		baseUrl: options.baseUrl,
		agentModel: modelRef(options.providerId, options.agentModel),
		memxModel: modelRef(options.providerId, options.memxModel),
		apiKey: options.apiKeyEnv ? {
			source: "env",
			id: options.apiKeyEnv
		} : "plaintext-redacted",
		embeddingProvider: options.embeddingProvider,
		embeddingModel: options.embeddingModel,
		embeddingPythonBin: options.embeddingPythonBin || null,
		steps
	};
}
async function runOpenClawQuickstart(rawOptions, deps = {}) {
	const options = normalizeOptions(rawOptions);
	const next = applyOpenClawQuickstartConfig(await readConfig(options.configPath), options);
	const steps = buildOpenClawQuickstartSteps(options);
	if (!options.dryRun) {
		await writeAtomicJson(options.configPath, next);
		const runCommand = deps.runCommand ?? defaultRunCommand;
		for (const step of steps) {
			const result = await runCommand(step.command, step.args);
			if (result.code !== 0) throw new Error(`quickstart step failed: ${step.key} (${step.command} ${step.args.join(" ")}) exited ${result.code}`);
		}
	}
	return {
		ok: true,
		dryRun: Boolean(options.dryRun),
		configPath: options.configPath,
		...publicSummary(options, steps),
		nextStep: options.skipRestart ? "Restart OpenClaw so the updated MemX config is applied." : "OpenClaw was restarted; run openclaw tui or your normal client."
	};
}
//#endregion
export { applyOpenClawQuickstartConfig, buildOpenClawQuickstartSteps, runOpenClawQuickstart };
