import { MemoryPluginConfig, MemxLogger } from "../types.mjs";

//#region src/pipeline/judgeModelConfig.d.ts
type SupportedJudgeProvider = "openai-compatible" | "anthropic" | "google" | "ollama";
type JudgeModelConfig = {
  configPath: string;
  provider: SupportedJudgeProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
};
declare function loadJudgeModelConfig(config: MemoryPluginConfig, logger: MemxLogger): JudgeModelConfig | null;
//#endregion
export { SupportedJudgeProvider };