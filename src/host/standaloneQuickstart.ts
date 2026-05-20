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
  type McpToolsProfile,
} from "./connect.js";

const DEFAULT_CONFIG_PATH = join(homedir(), ".memx", "config.json");
const DEFAULT_DB_PATH = join(homedir(), ".memx", "{agentId}", "memx.sqlite");
const DEFAULT_MEMX_URL = "http://127.0.0.1:3878";
const DEFAULT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small";
const DEFAULT_RUNTIME_DIRNAME = "runtime";
const DEFAULT_CODEX_MARKETPLACE_DIRNAME = "codex-marketplace";
const DEFAULT_CLAUDE_MARKETPLACE_DIRNAME = "claude-marketplace";
const MEMX_PLUGIN_VERSION = "2026.3.15";

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
  codexBin?: string;
  codexMarketplaceDir?: string;
  skipCodexPluginInstall?: boolean;
  claudeBin?: string;
  claudeMarketplaceDir?: string;
  skipClaudePluginInstall?: boolean;
  configPath?: string;
  codexConfigPath?: string;
  claudeConfigPath?: string;
  homeDir?: string;
  pythonBin?: string;
  memxUrl?: string;
  memxSecret?: string;
  mcpTools?: McpToolsProfile;
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
    | "codexBin"
    | "codexMarketplaceDir"
    | "claudeBin"
    | "claudeMarketplaceDir"
  >
> &
  Omit<
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
    | "codexBin"
    | "codexMarketplaceDir"
    | "claudeBin"
    | "claudeMarketplaceDir"
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

function localCodexMarketplaceDir(homeDir: string): string {
  return join(homeDir, ".memx", DEFAULT_CODEX_MARKETPLACE_DIRNAME);
}

function localClaudeMarketplaceDir(homeDir: string): string {
  return join(homeDir, ".memx", DEFAULT_CLAUDE_MARKETPLACE_DIRNAME);
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

function localRuntimeHookCommand(runtimeDir: string): McpCommandConfig {
  return {
    command: process.execPath,
    args: [join(runtimeDir, "src", "bin", "memx-hook.mjs")],
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function hookCommandLine(
  commandConfig: McpCommandConfig,
  host: "codex" | "claude-code",
  eventName: string,
): string {
  return [...[commandConfig.command, ...commandConfig.args], host, eventName].map(shellQuote).join(" ");
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

function isExpectedMissingCleanup(result: StandaloneQuickstartCommandResult): boolean {
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return /not found|not installed|not configured/iu.test(detail);
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
  if (
    options.mcpTools &&
    options.mcpTools !== "full" &&
    options.mcpTools !== "lifecycle-safe" &&
    options.mcpTools !== "none"
  ) {
    throw new Error("standalone quickstart requires --mcp-tools to be full, lifecycle-safe, or none");
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
    codexBin: trimOrUndefined(options.codexBin) ?? "codex",
    codexMarketplaceDir:
      trimOrUndefined(options.codexMarketplaceDir) ?? localCodexMarketplaceDir(homeDir),
    claudeBin: trimOrUndefined(options.claudeBin) ?? "claude",
    claudeMarketplaceDir:
      trimOrUndefined(options.claudeMarketplaceDir) ?? localClaudeMarketplaceDir(homeDir),
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

function hookEntry(
  commandConfig: McpCommandConfig,
  host: "codex" | "claude-code",
  eventName: string,
  statusMessage?: string,
) {
  return {
    hooks: [
      {
        type: "command",
        command: hookCommandLine(commandConfig, host, eventName),
        timeout: 5,
        ...(statusMessage ? { statusMessage } : {}),
      },
    ],
  };
}

function codexHooksConfig(commandConfig: McpCommandConfig): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [
        hookEntry(commandConfig, "codex", "SessionStart", "memx: opening memory session"),
      ],
      UserPromptSubmit: [
        hookEntry(commandConfig, "codex", "UserPromptSubmit", "memx: recalling memory"),
      ],
      PreToolUse: [
        {
          matcher: "Edit|Write|Read|Glob|Grep|apply_patch|exec_command",
          ...hookEntry(commandConfig, "codex", "PreToolUse"),
        },
      ],
      PostToolUse: [hookEntry(commandConfig, "codex", "PostToolUse")],
      PreCompact: [hookEntry(commandConfig, "codex", "PreCompact")],
      Stop: [hookEntry(commandConfig, "codex", "Stop")],
    },
  };
}

function codexPluginManifest(): Record<string, unknown> {
  return {
    name: "memx",
    version: MEMX_PLUGIN_VERSION,
    description:
      "memX: local-first semantic memory for coding agents. Native Codex lifecycle hooks plus MCP tools.",
    author: { name: "Neo Li" },
    license: "MIT",
    homepage: "https://github.com/NeoLi00/memX",
    repository: "https://github.com/NeoLi00/memX",
    skills: "./skills/",
    hooks: "./hooks/hooks.codex.json",
  };
}

function claudePluginManifest(): Record<string, unknown> {
  return {
    name: "memx",
    version: MEMX_PLUGIN_VERSION,
    description:
      "memX: local-first semantic memory for coding agents. Native Claude Code hooks plus MCP tools.",
    author: { name: "Neo Li" },
    license: "MIT",
    homepage: "https://github.com/NeoLi00/memX",
    repository: "https://github.com/NeoLi00/memX",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  };
}

function codexMarketplaceManifest(): Record<string, unknown> {
  return {
    name: "memx",
    plugins: [
      {
        name: "memx",
        source: { source: "local", path: "./plugins/memx" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
}

function claudeMarketplaceManifest(): Record<string, unknown> {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "memx",
    description: "memX local plugin marketplace for Claude Code native lifecycle hooks.",
    owner: { name: "Neo Li" },
    plugins: [
      {
        name: "memx",
        description: "memX: local-first semantic memory for coding agents.",
        author: { name: "Neo Li" },
        source: "./plugins/memx",
        category: "productivity",
        homepage: "https://github.com/NeoLi00/memX",
      },
    ],
  };
}

function claudeHooksConfig(): Record<string, unknown> {
  const hook = (eventName: string) => ({
    hooks: [
      {
        type: "command",
        command: `node "\${CLAUDE_PLUGIN_ROOT}/dist/.runtime/src/bin/memx-hook.mjs" claude-code ${eventName}`,
        timeout: 5,
      },
    ],
  });
  return {
    hooks: {
      SessionStart: [hook("SessionStart")],
      UserPromptSubmit: [hook("UserPromptSubmit")],
      PreToolUse: [
        {
          matcher: "Edit|Write|Read|Glob|Grep",
          ...hook("PreToolUse"),
        },
      ],
      PostToolUse: [hook("PostToolUse")],
      PostToolUseFailure: [hook("PostToolUseFailure")],
      PreCompact: [hook("PreCompact")],
      SubagentStart: [hook("SubagentStart")],
      SubagentStop: [hook("SubagentStop")],
      Notification: [hook("Notification")],
      TaskCompleted: [hook("TaskCompleted")],
      Stop: [hook("Stop")],
      SessionEnd: [hook("SessionEnd")],
    },
  };
}

function claudeMcpConfig(options: NormalizedStandaloneOptions): Record<string, unknown> {
  return {
    mcpServers: {
      memx: {
        command: process.execPath,
        args: ["${CLAUDE_PLUGIN_ROOT}/dist/.runtime/src/bin/memx-mcp.mjs"],
        env: {
          MEMX_URL: options.memxUrl,
          MEMX_SECRET: options.memxSecret ?? "",
          MEMX_MCP_TOOLS: options.mcpTools ?? "none",
        },
      },
    },
  };
}

async function installClaudeMarketplaceSnapshot(
  options: NormalizedStandaloneOptions,
): Promise<string> {
  const marketplaceDir = options.claudeMarketplaceDir;
  const pluginDir = join(marketplaceDir, "plugins", "memx");
  const tmpPluginDir = join("plugins", "memx");
  const tmp = `${marketplaceDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, ".claude-plugin"), { recursive: true });
  await mkdir(join(tmp, tmpPluginDir, ".claude-plugin"), { recursive: true });
  await mkdir(join(tmp, tmpPluginDir, "hooks"), { recursive: true });
  await mkdir(join(tmp, tmpPluginDir, "skills", "memx"), { recursive: true });
  await writeFile(
    join(tmp, ".claude-plugin", "marketplace.json"),
    `${JSON.stringify(claudeMarketplaceManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, tmpPluginDir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(claudePluginManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, tmpPluginDir, ".mcp.json"),
    `${JSON.stringify(claudeMcpConfig(options), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, tmpPluginDir, "hooks", "hooks.json"),
    `${JSON.stringify(claudeHooksConfig(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, tmpPluginDir, "skills", "memx", "SKILL.md"),
    [
      "---",
      "name: memx",
      "description: Use memX memory tools and lifecycle hooks for local agent memory.",
      "---",
      "",
      "# memX",
      "",
      "memX provides local semantic memory through lifecycle hooks and MCP tools.",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(join(tmp, tmpPluginDir, "dist"), { recursive: true });
  await cp(currentRuntimeRoot(), join(tmp, tmpPluginDir, "dist", ".runtime"), { recursive: true });
  await rm(marketplaceDir, { recursive: true, force: true });
  await mkdir(dirname(marketplaceDir), { recursive: true });
  await rename(tmp, marketplaceDir);
  return pluginDir;
}

async function installCodexMarketplaceSnapshot(
  options: NormalizedStandaloneOptions,
  hookCommandConfig: McpCommandConfig,
): Promise<string> {
  const marketplaceDir = options.codexMarketplaceDir;
  const pluginDir = join(marketplaceDir, "plugins", "memx");
  const tmp = `${marketplaceDir}.tmp-${process.pid}-${Date.now()}`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, ".agents", "plugins"), { recursive: true });
  await mkdir(join(tmp, "plugins", "memx", ".codex-plugin"), { recursive: true });
  await mkdir(join(tmp, "plugins", "memx", "hooks"), { recursive: true });
  await mkdir(join(tmp, "plugins", "memx", "skills", "memx"), { recursive: true });
  await writeFile(
    join(tmp, ".agents", "plugins", "marketplace.json"),
    `${JSON.stringify(codexMarketplaceManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, "plugins", "memx", ".codex-plugin", "plugin.json"),
    `${JSON.stringify(codexPluginManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, "plugins", "memx", "hooks", "hooks.codex.json"),
    `${JSON.stringify(codexHooksConfig(hookCommandConfig), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(tmp, "plugins", "memx", "skills", "memx", "SKILL.md"),
    [
      "---",
      "name: memx",
      "description: Use memX memory tools and lifecycle hooks for local agent memory.",
      "---",
      "",
      "# memX",
      "",
      "memX provides local semantic memory through lifecycle hooks and MCP tools.",
      "",
    ].join("\n"),
    "utf8",
  );
  await rm(marketplaceDir, { recursive: true, force: true });
  await mkdir(dirname(marketplaceDir), { recursive: true });
  await rename(tmp, marketplaceDir);
  return pluginDir;
}

async function installCodexPlugin(
  options: NormalizedStandaloneOptions,
  hookCommandConfig: McpCommandConfig,
  runCommand: (command: string, args: string[]) => Promise<StandaloneQuickstartCommandResult>,
  runBestEffortCommand: (command: string, args: string[]) => Promise<StandaloneQuickstartCommandResult>,
): Promise<Record<string, unknown>> {
  await installCodexMarketplaceSnapshot(options, hookCommandConfig);
  const warnings: string[] = [];
  const bestEffort = async (args: string[]) => {
    const result = await runBestEffortCommand(options.codexBin, args);
    if (result.code !== 0 && !isExpectedMissingCleanup(result)) {
      const detail = (result.stderr || result.stdout || "").trim();
      warnings.push(
        `${options.codexBin} ${args.join(" ")} exited ${result.code}${detail ? `: ${detail}` : ""}`,
      );
    }
  };
  await bestEffort(["plugin", "remove", "memx@memx"]);
  await bestEffort(["plugin", "marketplace", "remove", "memx"]);
  const addMarketplace = await runCommand(options.codexBin, [
    "plugin",
    "marketplace",
    "add",
    options.codexMarketplaceDir,
  ]);
  if (addMarketplace.code !== 0) {
    throw new Error(
      `standalone quickstart step failed: codex-plugin-marketplace (${options.codexBin} plugin marketplace add ${options.codexMarketplaceDir}) exited ${addMarketplace.code}`,
    );
  }
  const addPlugin = await runCommand(options.codexBin, ["plugin", "add", "memx@memx"]);
  if (addPlugin.code !== 0) {
    throw new Error(
      `standalone quickstart step failed: codex-plugin-install (${options.codexBin} plugin add memx@memx) exited ${addPlugin.code}`,
    );
  }
  return {
    marketplaceDir: options.codexMarketplaceDir,
    installed: true,
    warnings,
  };
}

async function installClaudePlugin(
  options: NormalizedStandaloneOptions,
  runCommand: (command: string, args: string[]) => Promise<StandaloneQuickstartCommandResult>,
  runBestEffortCommand: (command: string, args: string[]) => Promise<StandaloneQuickstartCommandResult>,
): Promise<Record<string, unknown>> {
  await installClaudeMarketplaceSnapshot(options);
  const warnings: string[] = [];
  const bestEffort = async (args: string[]) => {
    const result = await runBestEffortCommand(options.claudeBin, args);
    if (result.code !== 0 && !isExpectedMissingCleanup(result)) {
      const detail = (result.stderr || result.stdout || "").trim();
      warnings.push(
        `${options.claudeBin} ${args.join(" ")} exited ${result.code}${detail ? `: ${detail}` : ""}`,
      );
    }
  };
  await bestEffort(["plugin", "uninstall", "memx@memx"]);
  await bestEffort(["plugin", "uninstall", "memx"]);
  await bestEffort(["plugin", "marketplace", "remove", "memx"]);
  const addMarketplace = await runCommand(options.claudeBin, [
    "plugin",
    "marketplace",
    "add",
    options.claudeMarketplaceDir,
  ]);
  if (addMarketplace.code !== 0) {
    throw new Error(
      `standalone quickstart step failed: claude-plugin-marketplace (${options.claudeBin} plugin marketplace add ${options.claudeMarketplaceDir}) exited ${addMarketplace.code}`,
    );
  }
  const addPlugin = await runCommand(options.claudeBin, ["plugin", "install", "memx@memx"]);
  if (addPlugin.code !== 0) {
    throw new Error(
      `standalone quickstart step failed: claude-plugin-install (${options.claudeBin} plugin install memx@memx) exited ${addPlugin.code}`,
    );
  }
  return {
    marketplaceDir: options.claudeMarketplaceDir,
    installed: true,
    warnings,
  };
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

async function defaultRunCommandQuiet(
  command: string,
  args: string[],
): Promise<StandaloneQuickstartCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      resolve({ code: 1, stderr: error.message });
    });
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function writeHostConfig(
  options: NormalizedStandaloneOptions,
  commandConfig: McpCommandConfig,
  codexPlugin: Record<string, unknown> | null,
  claudePlugin: Record<string, unknown> | null,
  mcpTools: McpToolsProfile,
): Promise<Record<string, unknown> | null> {
  if (options.target === "codex") {
    const path = trimOrUndefined(options.codexConfigPath) ?? join(options.homeDir, ".codex", "config.toml");
    const current = existsSync(path) ? await readFile(path, "utf8") : "";
    await writeAtomic(
      path,
      applyCodexTomlConnect(
        current,
        options.memxUrl,
        options.memxSecret ?? "",
        commandConfig,
        mcpTools,
      ),
    );
    return { host: "codex", path, codexPlugin };
  }
  if (options.target === "claude-code") {
    if (claudePlugin) {
      return { host: "claude-code", claudePlugin };
    }
    const path = trimOrUndefined(options.claudeConfigPath) ?? join(options.homeDir, ".claude.json");
    const current = await readJson(path);
    const next = applyClaudeJsonConnect(
      current,
      options.memxUrl,
      options.memxSecret ?? "",
      commandConfig,
      mcpTools,
    );
    await writeAtomic(path, `${JSON.stringify(next, null, 2)}\n`);
    return { host: "claude-code", path };
  }
  return null;
}

function redactSummary(
  options: NormalizedStandaloneOptions,
  steps: StandaloneQuickstartCommandStep[],
  commandConfig: McpCommandConfig,
  codexPlugin: Record<string, unknown> | null,
  claudePlugin: Record<string, unknown> | null,
  mcpTools: McpToolsProfile,
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
    mcpTools,
    runtimeDir: options.runtimeDir,
    codexPlugin,
    claudePlugin,
    steps,
    mcpConfig:
      options.target === "mcp"
        ? buildGenericMcpConfig(options.memxUrl, options.memxSecret ?? "", commandConfig, mcpTools)
        : undefined,
  };
}

function defaultMcpToolsForOptions(options: NormalizedStandaloneOptions): McpToolsProfile {
  if (options.mcpTools) {
    return options.mcpTools;
  }
  if (options.target === "codex" && !options.skipCodexPluginInstall) {
    return "none";
  }
  if (options.target === "claude-code" && !options.skipClaudePluginInstall) {
    return "none";
  }
  return "full";
}

export async function runStandaloneMemxQuickstart(
  rawOptions: StandaloneMemxQuickstartOptions,
  deps: StandaloneQuickstartDeps = {},
): Promise<Record<string, unknown>> {
  const options = normalizeOptions(rawOptions);
  const mcpTools = defaultMcpToolsForOptions(options);
  const current = await readJson(options.configPath);
  const next = applyStandaloneMemxQuickstartConfig(current, options);
  const steps = buildStandaloneMemxQuickstartSteps(options);
  const commandConfig = localRuntimeMcpCommand(options.runtimeDir);
  const hookCommandConfig = localRuntimeHookCommand(options.runtimeDir);
  let hostConfig: Record<string, unknown> | null = null;
  let codexPlugin: Record<string, unknown> | null = null;
  let claudePlugin: Record<string, unknown> | null = null;
  if (!options.dryRun) {
    await installStandaloneRuntime(options.runtimeDir);
    await writeAtomic(options.configPath, `${JSON.stringify(next, null, 2)}\n`);
    const runCommand = deps.runCommand ?? defaultRunCommand;
    const runBestEffortCommand = deps.runCommand ?? defaultRunCommandQuiet;
    if (options.target === "codex" && !options.skipCodexPluginInstall) {
      codexPlugin = await installCodexPlugin(
        options,
        hookCommandConfig,
        runCommand,
        runBestEffortCommand,
      );
    }
    if (options.target === "claude-code" && !options.skipClaudePluginInstall) {
      claudePlugin = await installClaudePlugin(options, runCommand, runBestEffortCommand);
    }
    hostConfig = await writeHostConfig(options, commandConfig, codexPlugin, claudePlugin, mcpTools);
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
    ...redactSummary(options, steps, commandConfig, codexPlugin, claudePlugin, mcpTools),
    hostConfig,
    nextStep:
      "Start memx-server with this config, then use the configured MCP client or native plugin.",
  };
}
