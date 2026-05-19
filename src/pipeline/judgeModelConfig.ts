import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { MemxLogger, MemoryPluginConfig } from "../types.js";

export type SupportedJudgeProvider = "openai-compatible" | "anthropic" | "google" | "ollama";

export type JudgeModelConfig = {
  configPath: string;
  provider: SupportedJudgeProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

function resolveEnvTemplate(value: string): string | undefined {
  const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(value.trim());
  if (!match) {
    return value.trim() || undefined;
  }
  return process.env[match[1]]?.trim() || undefined;
}

function resolveSecretLikeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return resolveEnvTemplate(value);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.source === "env" && typeof record.id === "string") {
    return process.env[record.id]?.trim() || undefined;
  }
  return undefined;
}

function guessProvider(
  baseUrl: string,
  api?: string,
  providerKey?: string,
): SupportedJudgeProvider {
  if (
    api === "anthropic-messages" ||
    /anthropic/i.test(baseUrl) ||
    /anthropic/i.test(providerKey ?? "")
  ) {
    return "anthropic";
  }
  if (
    api === "google-generative-ai" ||
    /generativelanguage|google/i.test(baseUrl) ||
    /google/i.test(providerKey ?? "")
  ) {
    return "google";
  }
  if (api === "ollama" || /11434|ollama/i.test(baseUrl) || /ollama/i.test(providerKey ?? "")) {
    return "ollama";
  }
  return "openai-compatible";
}

export function loadJudgeModelConfig(
  config: MemoryPluginConfig,
  logger: MemxLogger,
): JudgeModelConfig | null {
  if (!config.advanced.llmClassifierEnabled) {
    return null;
  }

  const directBaseUrl = config.advanced.llmBaseURL?.trim();
  const directModel = config.advanced.llmClassifierModel?.trim();
  if (directBaseUrl && directModel) {
    const model = directModel.includes("/") ? directModel.split("/").at(-1) || directModel : directModel;
    return {
      configPath: process.env.MEMX_CONFIG_PATH?.trim() || "memx-config",
      provider:
        config.advanced.llmProvider ??
        guessProvider(directBaseUrl, undefined, config.advanced.llmProvider),
      baseUrl: directBaseUrl,
      model,
      apiKey: resolveSecretLikeString(config.advanced.llmApiKey),
      headers: config.advanced.llmHeaders,
    };
  }

  const cfgPath =
    process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
  if (!fs.existsSync(cfgPath)) {
    logger.debug?.(`memx: no config available for LLM reasoner at ${cfgPath}`);
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    const defaults = (raw.agents as Record<string, unknown> | undefined)?.defaults as
      | Record<string, unknown>
      | undefined;
    const modelEntry = (defaults?.model as Record<string, unknown> | undefined)?.primary;
    const requested =
      config.advanced.llmClassifierModel?.trim() ||
      (typeof modelEntry === "string" ? modelEntry : "");
    if (!requested) {
      return null;
    }

    const providers = ((raw.models as Record<string, unknown> | undefined)?.providers ??
      {}) as Record<string, Record<string, unknown>>;
    let providerKey: string | undefined;
    let model = requested;
    if (requested.includes("/")) {
      [providerKey, model] = requested.split("/", 2);
    } else if (typeof modelEntry === "string" && modelEntry.includes("/")) {
      [providerKey] = modelEntry.split("/", 2);
    }
    if (!providerKey) {
      providerKey = Object.keys(providers)[0];
    }
    if (!providerKey) {
      return null;
    }

    const providerCfg = providers[providerKey];
    if (!providerCfg) {
      return null;
    }
    const baseUrl = typeof providerCfg.baseUrl === "string" ? providerCfg.baseUrl.trim() : "";
    if (!baseUrl) {
      return null;
    }
    const headers =
      providerCfg.headers && typeof providerCfg.headers === "object"
        ? Object.fromEntries(
            Object.entries(providerCfg.headers as Record<string, unknown>)
              .map(([key, value]) => [key, resolveSecretLikeString(value)])
              .filter((entry): entry is [string, string] => Boolean(entry[1])),
          )
        : undefined;
    const provider = guessProvider(
      baseUrl,
      typeof providerCfg.api === "string" ? providerCfg.api : undefined,
      providerKey,
    );
    return {
      configPath: cfgPath,
      provider,
      baseUrl,
      model,
      apiKey: resolveSecretLikeString(providerCfg.apiKey),
      headers,
    };
  } catch (error) {
    logger.warn(`memx: failed to load LLM reasoner config (${String(error)})`);
    return null;
  }
}
