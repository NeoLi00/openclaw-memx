import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MEMORY_CONFIG } from "../config.js";
import type { MemoryEmbeddingProvider, MemoryLlmProvider, MemoryPluginConfig } from "../types.js";
import {
  applyClaudeJsonConnect,
  applyCodexTomlConnect,
  buildGenericMcpConfig,
  type McpCommandConfig,
} from "./connect.js";

const DEFAULT_CONFIG_PATH = join(homedir(), ".memx", "config.json");
const DEFAULT_DB_PATH = join(homedir(), ".memx", "{agentId}", "memx.sqlite");
const DEFAULT_MEMX_URL = "http://127.0.0.1:3878";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
const DEFAULT_RUNTIME_DIRNAME = "runtime";

export type StandaloneQuickstartTarget = "codex" | "claude-code" | "mcp";

export type StandaloneMemxQuickstartOptions = {
  target: StandaloneQuickstartTarget;
  llmProvider?: MemoryLlmProvider;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  llmApiKeyEnv?: string;
  embeddingProvider?: "local" | MemoryEmbeddingProvider;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingApiKeyEnv?: string;
  embeddingPythonBin?: string;
  embeddingCacheDir?: string;
  embeddingDevice?: "auto" | "cpu" | "mps" | "cuda";
  embeddingOllamaBaseUrl?: string;
  runtimeDir?: string;
  configPath?: string;
  codexConfigPath?: string;
  claudeConfigPath?: string;
  homeDir?: string;
  pythonBin?: string;
  memxUrl?: string;
  memxSecret?: string;
  skipEmbeddingDeps?: boolean;
  dryRun?: boolean;
};

type NormalizedStandaloneOptions = Required<
  Pick<
    StandaloneMemxQuickstartOptions,
    | "target"
    | "llmProvider"
    | "llmBaseUrl"
    | "llmModel"
    | "configPath"
    | "homeDir"
    | "pythonBin"
    | "memxUrl"
    | "runtimeDir"
  >
> &
  Omit<
    StandaloneMemxQuickstartOptions,
    "target" | "llmProvider" | "llmBaseUrl" | "llmModel" | "configPath" | "homeDir" | "pythonBin" | "memxUrl"
  > & {
    embeddingProvider: MemoryEmbeddingProvider;
    embeddingModel: string;
    embeddingPythonBin: string;
  };

export type StandaloneQuickstartCommandStep = {
  key: string;
  command: string;
  args: string[];
};

export type StandaloneQuickstartCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};

export type StandaloneQuickstartDeps = {
  runCommand?: (command: string, args: string[]) => Promise<StandaloneQuickstartCommandResult>;
};

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function localVenvDir(homeDir: string): string {
  return join(homeDir, ".memx", ".venv");
}

function localVenvPython(homeDir: string): string {
  const venv = localVenvDir(homeDir);
  return platform() === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");
}

function localRuntimeDir(homeDir: string): string {
  return join(homeDir, ".memx", DEFAULT_RUNTIME_DIRNAME);
}

function currentRuntimeRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

function localRuntimeMcpCommand(runtimeDir: string): McpCommandConfig {
  return {
    command: process.execPath,
    args: [join(runtimeDir, "src", "bin", "memx-mcp.mjs")],
  };
}

function normalizeEmbeddingProvider(
  provider: StandaloneMemxQuickstartOptions["embeddingProvider"],
): MemoryEmbeddingProvider {
  if (!provider || provider === "local") {
    return "sentence-transformers-local";
  }
  return provider;
}

function secretValue(value: string | undefined, envName: string | undefined): string | undefined {
  const direct = trimOrUndefined(value);
  const env = trimOrUndefined(envName);
  if (direct && env) {
    throw new Error("use either a direct API key or an API key env var, not both");
  }
  if (env) {
    return `\${${env}}`;
  }
  return direct;
}

function normalizeOptions(
  options: StandaloneMemxQuickstartOptions,
): NormalizedStandaloneOptions {
  const llmProvider = options.llmProvider ?? "openai-compatible";
  const llmBaseUrl = trimOrUndefined(options.llmBaseUrl);
  const llmModel = trimOrUndefined(options.llmModel);
  if (!llmBaseUrl) {
    throw new Error("standalone quickstart requires --llm-base-url");
  }
  if (!llmModel) {
    throw new Error("standalone quickstart requires --llm-model");
  }
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
    embeddingPythonBin:
      trimOrUndefined(options.embeddingPythonBin) ??
      (embeddingProvider === "sentence-transformers-local" ? localVenvPython(homeDir) : ""),
    configPath: trimOrUndefined(options.configPath) ?? DEFAULT_CONFIG_PATH,
    homeDir,
    pythonBin: trimOrUndefined(options.pythonBin) ?? "python3",
    memxUrl: trimOrUndefined(options.memxUrl) ?? DEFAULT_MEMX_URL,
    runtimeDir: trimOrUndefined(options.runtimeDir) ?? localRuntimeDir(homeDir),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return (override === undefined ? base : override) as T;
  }
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = key in output ? deepMerge(output[key], value) : value;
  }
  return output as T;
}

function baseStandaloneConfig(): MemoryPluginConfig {
  const config = structuredClone(DEFAULT_MEMORY_CONFIG);
  config.dbPath = DEFAULT_DB_PATH;
  config.defaultScope = "agent:{agentId}";
  config.allowedScopes = ["global", "agent:{agentId}", "session:{sessionKey}", "project:{project}"];
  config.advanced.llmClassifierEnabled = true;
  config.advanced.enableTurnScheduler = true;
  config.advanced.enableCompatibilityMemoryTools = false;
  return config;
}

export function applyStandaloneMemxQuickstartConfig(
  input: unknown,
  rawOptions: StandaloneMemxQuickstartOptions,
): MemoryPluginConfig {
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
  if (options.embeddingProvider === "ollama") {
    next.embedding.ollamaBaseURL = trimOrUndefined(options.embeddingOllamaBaseUrl);
  }
  if (options.embeddingProvider === "sentence-transformers-local") {
    next.embedding.localPythonBin = options.embeddingPythonBin;
    next.embedding.localDevice = options.embeddingDevice ?? "auto";
    if (trimOrUndefined(options.embeddingCacheDir)) {
      next.embedding.localCacheDir = trimOrUndefined(options.embeddingCacheDir);
    }
  }
  return next;
}

export function buildStandaloneMemxQuickstartSteps(
  rawOptions: StandaloneMemxQuickstartOptions,
): StandaloneQuickstartCommandStep[] {
  const options = normalizeOptions(rawOptions);
  if (options.embeddingProvider !== "sentence-transformers-local" || options.skipEmbeddingDeps) {
    return [];
  }
  return [
    {
      key: "embedding-venv",
      command: options.pythonBin,
      args: ["-m", "venv", localVenvDir(options.homeDir)],
    },
    {
      key: "embedding-deps",
      command: options.embeddingPythonBin,
      args: ["-m", "pip", "install", "-U", "pip", "sentence-transformers", "torch"],
    },
  ];
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

async function installStandaloneRuntime(runtimeDir: string): Promise<string> {
  const tmp = `${runtimeDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(dirname(runtimeDir), { recursive: true });
  await cp(currentRuntimeRoot(), tmp, { recursive: true });
  await rm(runtimeDir, { recursive: true, force: true });
  await rename(tmp, runtimeDir);
  return runtimeDir;
}

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<StandaloneQuickstartCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1 }));
  });
}

async function writeHostConfig(
  options: NormalizedStandaloneOptions,
  commandConfig: McpCommandConfig,
): Promise<Record<string, unknown> | null> {
  if (options.target === "codex") {
    const path = trimOrUndefined(options.codexConfigPath) ?? join(options.homeDir, ".codex", "config.toml");
    const current = existsSync(path) ? await readFile(path, "utf8") : "";
    await writeAtomic(
      path,
      applyCodexTomlConnect(current, options.memxUrl, options.memxSecret ?? "", commandConfig),
    );
    return { host: "codex", path };
  }
  if (options.target === "claude-code") {
    const path = trimOrUndefined(options.claudeConfigPath) ?? join(options.homeDir, ".claude.json");
    const current = await readJson(path);
    const next = applyClaudeJsonConnect(current, options.memxUrl, options.memxSecret ?? "", commandConfig);
    await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
    return { host: "claude-code", path };
  }
  return null;
}

function redactSummary(
  options: NormalizedStandaloneOptions,
  steps: StandaloneQuickstartCommandStep[],
  commandConfig: McpCommandConfig,
) {
  return {
    target: options.target,
    configPath: options.configPath,
    llmProvider: options.llmProvider,
    llmBaseUrl: options.llmBaseUrl,
    llmModel: options.llmModel,
    llmApiKey: options.llmApiKeyEnv
      ? { source: "env", id: options.llmApiKeyEnv }
      : options.llmApiKey
        ? "plaintext-redacted"
        : null,
    embeddingProvider: options.embeddingProvider,
    embeddingModel: options.embeddingModel,
    embeddingPythonBin: options.embeddingPythonBin || null,
    memxUrl: options.memxUrl,
    runtimeDir: options.runtimeDir,
    steps,
    mcpConfig:
      options.target === "mcp"
        ? buildGenericMcpConfig(options.memxUrl, options.memxSecret ?? "", commandConfig)
        : undefined,
  };
}

export async function runStandaloneMemxQuickstart(
  rawOptions: StandaloneMemxQuickstartOptions,
  deps: StandaloneQuickstartDeps = {},
): Promise<Record<string, unknown>> {
  const options = normalizeOptions(rawOptions);
  const current = await readJson(options.configPath);
  const next = applyStandaloneMemxQuickstartConfig(current, options);
  const steps = buildStandaloneMemxQuickstartSteps(options);
  const commandConfig = localRuntimeMcpCommand(options.runtimeDir);
  let hostConfig: Record<string, unknown> | null = null;
  if (!options.dryRun) {
    await installStandaloneRuntime(options.runtimeDir);
    await writeAtomic(options.configPath, `${JSON.stringify(next, null, 2)}\n`);
    hostConfig = await writeHostConfig(options, commandConfig);
    const runCommand = deps.runCommand ?? defaultRunCommand;
    for (const step of steps) {
      const result = await runCommand(step.command, step.args);
      if (result.code !== 0) {
        throw new Error(
          `standalone quickstart step failed: ${step.key} (${step.command} ${step.args.join(" ")}) exited ${result.code}`,
        );
      }
    }
  }
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    ...redactSummary(options, steps, commandConfig),
    hostConfig,
    nextStep:
      "Start memx-server with this config, then use the configured MCP client or native plugin.",
  };
}
