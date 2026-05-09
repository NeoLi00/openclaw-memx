import type { Command } from "commander";
import { type ReasonerProbeReport } from "../pipeline/reasoner.js";
import { type MemxRuntimeManager } from "../runtime.js";
import type { MemoryPluginConfig } from "../types.js";
type OpenClawConfigLike = {
    agents?: {
        list?: Array<{
            id?: string;
        }>;
    };
    plugins?: {
        allow?: string[];
        load?: {
            paths?: string[];
        };
        slots?: Record<string, string>;
        entries?: Record<string, Record<string, unknown>>;
    };
    models?: {
        providers?: Record<string, {
            baseUrl?: string;
            api?: string;
            models?: Array<{
                id?: string;
            }>;
        }>;
    };
};
type MemxSetupOptions = {
    configPath?: string;
    enableLlmJudge?: boolean;
    llmModel?: string;
    embeddingProvider?: MemoryPluginConfig["embedding"]["provider"];
    embeddingModel?: string;
    embeddingPythonBin?: string;
    embeddingCacheDir?: string;
    embeddingDevice?: "auto" | "cpu" | "mps" | "cuda";
};
type MemxDoctorReport = {
    ok: boolean;
    configPath: string;
    reasonerConfigPath: string | null;
    pluginLoaded: boolean;
    checks: Array<{
        key: string;
        ok: boolean;
        detail: string;
    }>;
    recommendedFixes: string[];
    configSummary: {
        allowed: boolean;
        memorySlot: string | null;
        pluginEnabled: boolean;
        turnSchedulerEnabled: boolean;
        llmClassifierEnabled: boolean;
        llmClassifierModel: string | null;
        embeddingProvider: string | null;
        embeddingModel: string | null;
        dbPath: string | null;
    };
    reasonerProbe?: ReasonerProbeReport;
};
export declare function applyMemxSetupToConfig(appConfig: OpenClawConfigLike, pluginConfig: MemoryPluginConfig, options?: MemxSetupOptions): OpenClawConfigLike;
export declare function buildMemxDoctorReport(params: {
    configPath: string;
    appConfig: OpenClawConfigLike;
    pluginConfig: MemoryPluginConfig;
}): MemxDoctorReport;
export declare function registerMemxCli(params: {
    program: Command;
    pluginConfig: MemoryPluginConfig;
    appConfig: {
        agents?: {
            list?: Array<{
                id?: string;
            }>;
        };
    };
    manager: MemxRuntimeManager;
}): void;
export {};
