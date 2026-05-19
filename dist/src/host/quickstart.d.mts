import { MemoryLlmProvider, MemoryPluginConfig } from "../types.mjs";

//#region src/host/quickstart.d.ts
type SecretRef = {
  source: "env";
  provider: "default";
  id: string;
};
type OpenClawModelEntry = {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: Record<string, number>;
  contextWindow?: number;
  maxTokens?: number;
};
type OpenClawConfigLike = {
  agents?: {
    defaults?: {
      model?: string | {
        primary?: string;
        fallbacks?: string[];
        [key: string]: unknown;
      };
      models?: Record<string, Record<string, unknown>>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  models?: {
    providers?: Record<string, {
      api?: string;
      baseUrl?: string;
      apiKey?: string | SecretRef;
      models?: OpenClawModelEntry[];
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  plugins?: {
    allow?: string[];
    slots?: Record<string, string>;
    entries?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type OpenClawQuickstartOptions = {
  llmProvider?: MemoryLlmProvider;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  llmApiKeyEnv?: string; /** @deprecated Use llmProvider plus the default provider id. */
  providerId?: string; /** @deprecated Use llmBaseUrl. */
  baseUrl?: string; /** @deprecated Use llmApiKey. */
  apiKey?: string; /** @deprecated Use llmApiKeyEnv. */
  apiKeyEnv?: string;
  agentModel?: string; /** @deprecated Use llmModel. */
  memxModel?: string;
  embeddingProvider?: "local" | MemoryPluginConfig["embedding"]["provider"];
  embeddingModel?: string;
  embeddingPythonBin?: string;
  embeddingCacheDir?: string;
  embeddingDevice?: "auto" | "cpu" | "mps" | "cuda";
  configPath?: string;
  homeDir?: string;
  openclawBin?: string;
  pythonBin?: string;
  skipEmbeddingDeps?: boolean;
  skipPluginInstall?: boolean;
  skipRestart?: boolean;
  skipDoctor?: boolean;
  dryRun?: boolean;
};
type QuickstartCommandStep = {
  key: string;
  command: string;
  args: string[];
};
type QuickstartCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};
type QuickstartDeps = {
  runCommand?: (command: string, args: string[]) => Promise<QuickstartCommandResult>;
};
declare function applyOpenClawQuickstartConfig(input: unknown, rawOptions: OpenClawQuickstartOptions): OpenClawConfigLike;
declare function buildOpenClawQuickstartSteps(rawOptions: OpenClawQuickstartOptions): QuickstartCommandStep[];
declare function runOpenClawQuickstart(rawOptions: OpenClawQuickstartOptions, deps?: QuickstartDeps): Promise<Record<string, unknown>>;
//#endregion
export { OpenClawQuickstartOptions, QuickstartCommandResult, QuickstartCommandStep, QuickstartDeps, applyOpenClawQuickstartConfig, buildOpenClawQuickstartSteps, runOpenClawQuickstart };